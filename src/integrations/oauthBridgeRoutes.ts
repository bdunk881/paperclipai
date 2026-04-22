import express from "express";
import { AuthenticatedRequest, requireAuth } from "../auth/authMiddleware";
import { slackConnectorService } from "./slack/service";
import { linearConnectorService } from "./linear/service";
import { shopifyConnectorService } from "./shopify/service";
import { docuSignConnectorService } from "./docusign/service";
import { teamsConnectorService } from "./teams/service";
import { posthogConnectorService } from "./posthog/service";
import { intercomConnectorService } from "./intercom/service";
import { datadogAzureMonitorConnectorService } from "./datadog-azure-monitor/service";
import { slackCredentialStore } from "./slack/credentialStore";
import { linearCredentialStore } from "./linear/credentialStore";
import { shopifyCredentialStore } from "./shopify/credentialStore";
import { docuSignCredentialStore } from "./docusign/credentialStore";
import { teamsCredentialStore } from "./teams/credentialStore";
import { posthogCredentialStore } from "./posthog/credentialStore";
import { intercomCredentialStore } from "./intercom/credentialStore";
import { monitoringCredentialStore } from "./datadog-azure-monitor/credentialStore";

type UnifiedProvider =
  | "slack"
  | "linear"
  | "shopify"
  | "docusign"
  | "teams"
  | "posthog"
  | "intercom"
  | "datadog-azure-monitor";

type StatusProvider =
  | UnifiedProvider
  | "stripe";

type ProviderStatus = {
  connected: boolean;
  connectedAt?: string;
  scopes?: string[];
};

const PROVIDERS: Set<UnifiedProvider> = new Set([
  "slack",
  "linear",
  "shopify",
  "docusign",
  "teams",
  "posthog",
  "intercom",
  "datadog-azure-monitor",
]);

const STATUS_PROVIDERS: StatusProvider[] = [
  "slack",
  "linear",
  "shopify",
  "docusign",
  "teams",
  "posthog",
  "intercom",
  "datadog-azure-monitor",
  "stripe",
];

function isConnected(connectedAt: string | undefined, scopes: string[] | undefined) {
  if (!connectedAt) {
    return { connected: false as const };
  }
  return {
    connected: true as const,
    connectedAt,
    ...(Array.isArray(scopes) && scopes.length > 0 ? { scopes } : {}),
  };
}

function datadogAzureMonitorStatus(userId: string) {
  const datadogCredential = monitoringCredentialStore.getActiveByUserAndProvider(userId, "datadog");
  const azureCredential = monitoringCredentialStore.getActiveByUserAndProvider(userId, "azure_monitor");

  const chosen = [datadogCredential, azureCredential]
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  return isConnected(chosen?.createdAt, chosen?.scopes);
}

function connectionStatusForCredential(credential: { createdAt: string; scopes: string[] } | null | undefined): ProviderStatus {
  return isConnected(credential?.createdAt, credential?.scopes);
}

const router = express.Router();

function parseProvider(value: string | undefined): UnifiedProvider | null {
  if (!value) {
    return null;
  }

  if (PROVIDERS.has(value as UnifiedProvider)) {
    return value as UnifiedProvider;
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

function getShopDomain(req: AuthenticatedRequest): string {
  const shopFromBody = (req.body as { shopDomain?: unknown })?.shopDomain;
  const shopFromQuery = req.query.shop;

  if (typeof shopFromBody === "string" && shopFromBody.trim()) {
    return shopFromBody.trim();
  }

  if (typeof shopFromQuery === "string" && shopFromQuery.trim()) {
    return shopFromQuery.trim();
  }

  return "";
}

router.post("/:provider/connect", requireAuth, (req: AuthenticatedRequest, res) => {
  const provider = parseProvider(req.params.provider);
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
        case "slack":
          return slackConnectorService.beginOAuth(userId);
        case "linear":
          return linearConnectorService.beginOAuth(userId);
        case "shopify": {
          const shopDomain = getShopDomain(req);
          if (!shopDomain) {
            throw new Error("shopDomain is required for Shopify OAuth");
          }
          return shopifyConnectorService.beginOAuth({ userId, shopDomain });
        }
        case "docusign":
          return docuSignConnectorService.beginOAuth(userId);
        case "teams":
          return teamsConnectorService.beginOAuth(userId);
        case "posthog":
          return posthogConnectorService.beginOAuth(userId);
        case "intercom":
          return intercomConnectorService.beginOAuth(userId);
        case "datadog-azure-monitor":
          return datadogAzureMonitorConnectorService.beginAzureOAuth(userId);
        default:
          throw new Error("Unsupported provider");
      }
    })();

    res.status(201).json({ redirectUrl: flow.authUrl });
  } catch (error) {
    const message = errorMessage(error);
    const statusCode = message.includes("required") ? 400 : errorStatusCode(error);
    res.status(statusCode).json({ error: message });
  }
});

router.get("/status", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const slackCredential = slackCredentialStore.getActiveByUser(userId);
  const linearCredential = linearCredentialStore.getActiveByUser(userId);
  const shopifyCredential = shopifyCredentialStore.getActiveByUser(userId);
  const docusignCredential = docuSignCredentialStore.getActiveByUser(userId);
  const teamsCredential = teamsCredentialStore.getActiveByUser(userId);
  const posthogCredential = posthogCredentialStore.getActiveByUser(userId);
  const intercomCredential = intercomCredentialStore.getActiveByUser(userId);

  const providers: Record<StatusProvider, ProviderStatus> = {
    slack: connectionStatusForCredential(slackCredential),
    linear: connectionStatusForCredential(linearCredential),
    shopify: connectionStatusForCredential(shopifyCredential),
    docusign: connectionStatusForCredential(docusignCredential),
    teams: connectionStatusForCredential(teamsCredential),
    posthog: connectionStatusForCredential(posthogCredential),
    intercom: connectionStatusForCredential(intercomCredential),
    "datadog-azure-monitor": datadogAzureMonitorStatus(userId),
    stripe: { connected: false },
  };

  for (const provider of STATUS_PROVIDERS) {
    if (!providers[provider]) {
      providers[provider] = { connected: false };
    }
  }

  res.json({ providers });
});

router.get("/callback", async (req, res) => {
  const provider = parseProvider(typeof req.query.provider === "string" ? req.query.provider : undefined);
  const providerName = typeof req.query.provider === "string" && req.query.provider.trim()
    ? req.query.provider
    : "unknown";

  if (!provider) {
    res.redirect(dashboardRedirect({ provider: providerName, status: "error", message: "Unsupported provider" }));
    return;
  }

  const upstreamError = typeof req.query.error === "string" ? req.query.error : "";
  const upstreamErrorDescription = typeof req.query.error_description === "string"
    ? req.query.error_description
    : "";

  if (upstreamError) {
    const message = upstreamErrorDescription || upstreamError;
    res.redirect(
      dashboardRedirect({ provider, status: "error", message: `Authorization failed: ${message}` })
    );
    return;
  }

  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const shop = typeof req.query.shop === "string" ? req.query.shop : undefined;

  if (!code || !state) {
    res.redirect(
      dashboardRedirect({ provider, status: "error", message: "Missing OAuth code or state" })
    );
    return;
  }

  try {
    switch (provider) {
      case "slack":
        await slackConnectorService.completeOAuth({ code, state });
        break;
      case "linear":
        await linearConnectorService.completeOAuth({ code, state });
        break;
      case "shopify":
        await shopifyConnectorService.completeOAuth({ code, state, shop });
        break;
      case "docusign":
        await docuSignConnectorService.completeOAuth({ code, state });
        break;
      case "teams":
        await teamsConnectorService.completeOAuth({ code, state });
        break;
      case "posthog":
        await posthogConnectorService.completeOAuth({ code, state });
        break;
      case "intercom":
        await intercomConnectorService.completeOAuth({ code, state });
        break;
      case "datadog-azure-monitor":
        await datadogAzureMonitorConnectorService.completeAzureOAuth({ code, state });
        break;
      default:
        throw new Error("Unsupported provider");
    }

    res.redirect(dashboardRedirect({ provider, status: "success" }));
  } catch (error) {
    res.redirect(
      dashboardRedirect({ provider, status: "error", message: errorMessage(error) })
    );
  }
});

router.delete("/:provider/disconnect", requireAuth, async (req: AuthenticatedRequest, res) => {
  const provider = parseProvider(req.params.provider);
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
    case "slack": {
      const current = slackCredentialStore.getActiveByUser(userId);
      if (current) {
        slackConnectorService.disconnect(userId, current.id);
      }
      break;
    }
    case "linear": {
      const current = linearCredentialStore.getActiveByUser(userId);
      if (current) {
        linearConnectorService.disconnect(userId, current.id);
      }
      break;
    }
    case "shopify": {
      const current = shopifyCredentialStore.getActiveByUser(userId);
      if (current) {
        shopifyConnectorService.disconnect(userId, current.id);
      }
      break;
    }
    case "docusign": {
      const current = docuSignCredentialStore.getActiveByUser(userId);
      if (current) {
        docuSignConnectorService.disconnect(userId, current.id);
      }
      break;
    }
    case "teams": {
      const current = teamsCredentialStore.getActiveByUser(userId);
      if (current) {
        teamsConnectorService.disconnect(userId, current.id);
      }
      break;
    }
    case "posthog": {
      const current = posthogCredentialStore.getActiveByUser(userId);
      if (current) {
        posthogConnectorService.disconnect(userId, current.id);
      }
      break;
    }
    case "intercom": {
      const current = intercomCredentialStore.getActiveByUser(userId);
      if (current) {
        intercomConnectorService.disconnect(userId, current.id);
      }
      break;
    }
    case "datadog-azure-monitor": {
      const datadog = monitoringCredentialStore.getActiveByUserAndProvider(userId, "datadog");
      const azure = monitoringCredentialStore.getActiveByUserAndProvider(userId, "azure_monitor");
      if (datadog) {
        datadogAzureMonitorConnectorService.disconnect(userId, datadog.id);
      }
      if (azure) {
        datadogAzureMonitorConnectorService.disconnect(userId, azure.id);
      }
      break;
    }
    default:
      break;
  }

  res.status(204).send();
});

export default router;
