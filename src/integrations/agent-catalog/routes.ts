import express from "express";
import { AuthenticatedRequest, requireAuth } from "../../auth/authMiddleware";
import { agentCatalogConnectorService } from "./service";
import { AGENT_CATALOG_PROVIDERS, AgentCatalogConnectorError, AgentCatalogProvider } from "./types";

const router = express.Router();

function providerFromParam(value: string): AgentCatalogProvider | null {
  return AGENT_CATALOG_PROVIDERS.includes(value as AgentCatalogProvider)
    ? (value as AgentCatalogProvider)
    : null;
}

function getUserId(req: AuthenticatedRequest): string | null {
  const userId = req.auth?.sub;
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

function dashboardCallbackUrl(params: {
  provider: AgentCatalogProvider;
  status: "success" | "error";
  message?: string;
}): string {
  const base = (process.env.DASHBOARD_APP_URL ?? "http://localhost:5173").replace(/\/$/, "");
  const url = new URL(`${base}/agents/oauth/callback`);
  url.searchParams.set("provider", params.provider);
  url.searchParams.set("status", params.status);
  if (params.message) {
    url.searchParams.set("message", params.message);
  }
  return url.toString();
}

function handleError(res: express.Response, error: unknown): void {
  if (error instanceof AgentCatalogConnectorError) {
    res.status(error.statusCode).json({ error: error.message, type: error.type });
    return;
  }

  res.status(500).json({ error: "Unexpected agent catalog connector error", type: "upstream" });
}

router.post("/:provider/oauth/start", requireAuth, (req: AuthenticatedRequest, res) => {
  const provider = providerFromParam(req.params.provider);
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
    const flow = agentCatalogConnectorService.beginOAuth(userId, provider);
    res.status(201).json(flow);
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/:provider/oauth/callback", async (req, res) => {
  const provider = providerFromParam(req.params.provider);
  if (!provider) {
    res.status(400).json({ error: "Unsupported provider" });
    return;
  }

  const upstreamError = typeof req.query.error === "string" ? req.query.error : "";
  const upstreamErrorDescription = typeof req.query.error_description === "string"
    ? req.query.error_description
    : "";
  if (upstreamError) {
    const message = upstreamErrorDescription || upstreamError;
    res.redirect(
      dashboardCallbackUrl({ provider, status: "error", message: `Authorization failed: ${message}` })
    );
    return;
  }

  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";

  if (!code || !state) {
    res.redirect(
      dashboardCallbackUrl({ provider, status: "error", message: "Missing OAuth code or state" })
    );
    return;
  }

  try {
    await agentCatalogConnectorService.completeOAuth({ provider, code, state });
    res.redirect(dashboardCallbackUrl({ provider, status: "success" }));
  } catch (error) {
    if (error instanceof AgentCatalogConnectorError) {
      res.redirect(
        dashboardCallbackUrl({ provider, status: "error", message: error.message })
      );
      return;
    }
    res.redirect(
      dashboardCallbackUrl({ provider, status: "error", message: "OAuth callback failed" })
    );
  }
});

router.get("/connections", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const connections = agentCatalogConnectorService.listConnections(userId);
  res.json({ connections, total: connections.length });
});

router.post("/:provider/test", requireAuth, async (req: AuthenticatedRequest, res) => {
  const provider = providerFromParam(req.params.provider);
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
    const identity = await agentCatalogConnectorService.testConnection(userId, provider);
    res.json({ success: true, accountLabel: identity.accountLabel });
  } catch (error) {
    handleError(res, error);
  }
});

router.delete("/:provider/connection", requireAuth, (req: AuthenticatedRequest, res) => {
  const provider = providerFromParam(req.params.provider);
  if (!provider) {
    res.status(400).json({ error: "Unsupported provider" });
    return;
  }

  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const revoked = agentCatalogConnectorService.disconnect(userId, provider);
  if (!revoked) {
    res.status(404).json({ error: `${provider} connection not found` });
    return;
  }

  res.status(204).send();
});

router.get("/health", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const connections = agentCatalogConnectorService.listConnections(userId);
  const byProvider = AGENT_CATALOG_PROVIDERS.map((provider) => {
    const connected = connections.some((connection) => connection.provider === provider);
    return {
      provider,
      status: connected ? "ok" : "down",
      auth: connected,
      checkedAt: new Date().toISOString(),
    };
  });

  res.json({ status: byProvider.every((p) => p.status === "ok") ? "ok" : "degraded", providers: byProvider });
});

export default router;
