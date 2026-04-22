import express from "express";
import { AuthenticatedRequest, requireAuth } from "../auth/authMiddleware";
import { apolloCredentialStore } from "./apollo/credentialStore";
import { apolloConnectorService } from "./apollo/service";
import { composioCredentialStore } from "./composio/credentialStore";
import { composioConnectorService } from "./composio/service";
import { gmailCredentialStore } from "./gmail/credentialStore";
import { gmailConnectorService } from "./gmail/service";
import { hubSpotCredentialStore } from "./hubspot/credentialStore";
import { hubSpotConnectorService } from "./hubspot/service";
import { sentryCredentialStore } from "./sentry/credentialStore";
import { sentryConnectorService } from "./sentry/service";
import { slackCredentialStore } from "./slack/credentialStore";
import { slackConnectorService } from "./slack/service";
import { stripeCredentialStore } from "./stripe/credentialStore";
import { stripeConnectorService } from "./stripe/service";

type OAuthProvider = "apollo" | "gmail" | "hubspot" | "sentry" | "slack" | "stripe";
type StatusProvider = OAuthProvider | "composio";

type ProviderStatus = {
  connected: boolean;
  connectedAt?: string;
  scopes?: string[];
};

const OAUTH_PROVIDERS: Set<OAuthProvider> = new Set([
  "apollo",
  "gmail",
  "hubspot",
  "sentry",
  "slack",
  "stripe",
]);

const STATUS_PROVIDERS: StatusProvider[] = [
  "apollo",
  "gmail",
  "hubspot",
  "sentry",
  "slack",
  "stripe",
  "composio",
];

function isConnected(
  connectedAt: string | undefined,
  scopes: string[] | undefined
): ProviderStatus {
  if (!connectedAt) {
    return { connected: false };
  }

  return {
    connected: true,
    connectedAt,
    ...(Array.isArray(scopes) && scopes.length > 0 ? { scopes } : {}),
  };
}

function parseOAuthProvider(value: string | undefined): OAuthProvider | null {
  if (!value) {
    return null;
  }

  if (OAUTH_PROVIDERS.has(value as OAuthProvider)) {
    return value as OAuthProvider;
  }

  return null;
}

function parseStatusProvider(value: string | undefined): StatusProvider | null {
  if (!value) {
    return null;
  }

  if (STATUS_PROVIDERS.includes(value as StatusProvider)) {
    return value as StatusProvider;
  }

  return null;
}

function getUserId(req: AuthenticatedRequest): string | null {
  const userId = req.auth?.sub;
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

function dashboardRedirect(params: {
  provider: string;
  status: "success" | "error";
  message?: string;
}): string {
  const base = (process.env.DASHBOARD_APP_URL ?? "http://localhost:5173").replace(/\/$/, "");
  const url = new URL(`${base}/integrations`);
  url.searchParams.set("provider", params.provider);
  url.searchParams.set("status", params.status);
  if (params.message) {
    url.searchParams.set("message", params.message);
  }
  return url.toString();
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "OAuth callback failed";
}

function errorStatusCode(error: unknown): number {
  if (error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number") {
    return error.statusCode;
  }
  return 500;
}

const router = express.Router();

router.post("/:provider/connect", requireAuth, (req: AuthenticatedRequest, res) => {
  const provider = parseOAuthProvider(req.params.provider);
  if (!provider) {
    res.status(400).json({ error: "Unsupported provider" });
    return;
  }

  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const flow = (() => {
      switch (provider) {
        case "apollo":
          return apolloConnectorService.beginOAuth(userId);
        case "gmail":
          return gmailConnectorService.beginOAuth(userId);
        case "hubspot":
          return hubSpotConnectorService.beginOAuth(userId);
        case "sentry":
          return sentryConnectorService.beginOAuth(userId);
        case "slack":
          return slackConnectorService.beginOAuth(userId);
        case "stripe":
          return stripeConnectorService.beginOAuth(userId);
      }
    })();

    res.status(201).json({ redirectUrl: flow.authUrl });
  } catch (error) {
    res.status(errorStatusCode(error)).json({ error: errorMessage(error) });
  }
});

router.get("/status", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const [
    apolloCredential,
    gmailCredential,
    hubspotCredential,
    sentryCredential,
    slackCredential,
    stripeCredential,
    composioCredential,
  ] = await Promise.all([
    apolloCredentialStore.getActiveByUserAsync(userId),
    gmailCredentialStore.getActiveByUserAsync(userId),
    hubSpotCredentialStore.getActiveByUserAsync(userId),
    sentryCredentialStore.getActiveByUserAsync(userId),
    slackCredentialStore.getActiveByUserAsync(userId),
    stripeCredentialStore.getActiveByUserAsync(userId),
    composioCredentialStore.getActiveByUserAsync(userId),
  ]);

  const providers: Record<StatusProvider, ProviderStatus> = {
    apollo: isConnected(apolloCredential?.createdAt, apolloCredential?.scopes),
    gmail: isConnected(gmailCredential?.createdAt, gmailCredential?.scopes),
    hubspot: isConnected(hubspotCredential?.createdAt, hubspotCredential?.scopes),
    sentry: isConnected(sentryCredential?.createdAt, sentryCredential?.scopes),
    slack: isConnected(slackCredential?.createdAt, slackCredential?.scopes),
    stripe: isConnected(stripeCredential?.createdAt, stripeCredential?.scopes),
    composio: isConnected(composioCredential?.createdAt, undefined),
  };

  res.json({ providers });
});

router.get("/callback", async (req, res) => {
  const provider = parseOAuthProvider(typeof req.query.provider === "string" ? req.query.provider : undefined);
  const providerName =
    typeof req.query.provider === "string" && req.query.provider.trim()
      ? req.query.provider
      : "unknown";

  if (!provider) {
    res.redirect(dashboardRedirect({ provider: providerName, status: "error", message: "Unsupported provider" }));
    return;
  }

  const upstreamError = typeof req.query.error === "string" ? req.query.error : "";
  const upstreamErrorDescription =
    typeof req.query.error_description === "string" ? req.query.error_description : "";

  if (upstreamError) {
    const message = upstreamErrorDescription || upstreamError;
    res.redirect(dashboardRedirect({ provider, status: "error", message: `Authorization failed: ${message}` }));
    return;
  }

  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";

  if (!code || !state) {
    res.redirect(dashboardRedirect({ provider, status: "error", message: "Missing OAuth code or state" }));
    return;
  }

  try {
    switch (provider) {
      case "apollo":
        await apolloConnectorService.completeOAuth({ code, state });
        break;
      case "gmail":
        await gmailConnectorService.completeOAuth({ code, state });
        break;
      case "hubspot":
        await hubSpotConnectorService.completeOAuth({ code, state });
        break;
      case "sentry":
        await sentryConnectorService.completeOAuth({ code, state });
        break;
      case "slack":
        await slackConnectorService.completeOAuth({ code, state });
        break;
      case "stripe":
        await stripeConnectorService.completeOAuth({ code, state });
        break;
    }

    res.redirect(dashboardRedirect({ provider, status: "success" }));
  } catch (error) {
    res.redirect(dashboardRedirect({ provider, status: "error", message: errorMessage(error) }));
  }
});

router.delete("/:provider/disconnect", requireAuth, async (req: AuthenticatedRequest, res) => {
  const provider = parseStatusProvider(req.params.provider);
  if (!provider) {
    res.status(400).json({ error: "Unsupported provider" });
    return;
  }

  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  switch (provider) {
    case "apollo": {
      const current = await apolloCredentialStore.getActiveByUserAsync(userId);
      if (current) {
        await apolloConnectorService.disconnect(userId, current.id);
      }
      break;
    }
    case "gmail": {
      const current = await gmailCredentialStore.getActiveByUserAsync(userId);
      if (current) {
        await gmailConnectorService.disconnect(userId, current.id);
      }
      break;
    }
    case "hubspot": {
      const current = await hubSpotCredentialStore.getActiveByUserAsync(userId);
      if (current) {
        await hubSpotConnectorService.disconnect(userId, current.id);
      }
      break;
    }
    case "sentry": {
      const current = await sentryCredentialStore.getActiveByUserAsync(userId);
      if (current) {
        await sentryConnectorService.disconnect(userId, current.id);
      }
      break;
    }
    case "slack": {
      const current = await slackCredentialStore.getActiveByUserAsync(userId);
      if (current) {
        await slackConnectorService.disconnect(userId, current.id);
      }
      break;
    }
    case "stripe": {
      const current = await stripeCredentialStore.getActiveByUserAsync(userId);
      if (current) {
        await stripeConnectorService.disconnect(userId, current.id);
      }
      break;
    }
    case "composio": {
      const current = await composioCredentialStore.getActiveByUserAsync(userId);
      if (current) {
        await composioConnectorService.disconnect(userId, current.id);
      }
      break;
    }
  }

  res.status(204).send();
});

export default router;
