import express from "express";
import { requireAuth, AuthenticatedRequest } from "../../auth/authMiddleware";
import { logComposio } from "./logger";
import { composioConnectorService } from "./service";
import { ComposioWebhookEvent, ConnectorError } from "./types";
import { verifyComposioWebhook } from "./webhook";

const router = express.Router();

function getUserId(req: AuthenticatedRequest): string | null {
  const userId = req.auth?.sub;
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

function handleError(res: express.Response, error: unknown): void {
  if (error instanceof ConnectorError) {
    res.status(error.statusCode).json({
      error: error.message,
      type: error.type,
    });
    return;
  }

  res.status(500).json({
    error: "Unexpected Composio connector error",
    type: "upstream",
  });
}

router.post("/connect-api-key", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { apiKey } = req.body as { apiKey?: string };
  if (!apiKey || !apiKey.trim()) {
    res.status(400).json({ error: "apiKey is required" });
    return;
  }

  try {
    const connection = await composioConnectorService.connectApiKey({
      userId,
      apiKey: apiKey.trim(),
    });
    res.status(201).json({ connection });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/connections", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const connections = await composioConnectorService.listConnections(userId);
  res.json({ connections, total: connections.length });
});

router.post("/test-connection", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const result = await composioConnectorService.testConnection(userId);
    res.json({ success: true, ...result });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/health", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const health = await composioConnectorService.health(userId);
  const statusCode = health.status === "ok" ? 200 : health.status === "degraded" ? 206 : 503;
  res.status(statusCode).json(health);
});

router.delete("/connections/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const deleted = await composioConnectorService.disconnect(userId, req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Composio connection not found" });
    return;
  }

  res.status(204).send();
});

router.get("/tools/enum", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const tools = await composioConnectorService.listToolEnums(userId);
    res.json({ tools, total: tools.length });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/tools/execute", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { toolSlug, arguments: toolArgs, connectedAccountId, version } = req.body as {
    toolSlug?: string;
    arguments?: Record<string, unknown>;
    connectedAccountId?: string;
    version?: string;
  };

  if (!toolSlug || !toolSlug.trim()) {
    res.status(400).json({ error: "toolSlug is required" });
    return;
  }

  try {
    const result = await composioConnectorService.executeTool(userId, {
      toolSlug: toolSlug.trim(),
      arguments: toolArgs,
      connectedAccountId: connectedAccountId?.trim() || undefined,
      version: version?.trim() || undefined,
    });

    res.status(result.successful ? 200 : 502).json(result);
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/connected-accounts", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const parseCsv = (value: unknown): string[] | undefined =>
    typeof value === "string"
      ? value.split(",").map((item) => item.trim()).filter(Boolean)
      : undefined;

  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;

  try {
    const result = await composioConnectorService.listConnectedAccounts(userId, {
      toolkitSlugs: parseCsv(req.query.toolkitSlugs),
      statuses: parseCsv(req.query.statuses),
      targetUserIds: parseCsv(req.query.targetUserIds),
      limit: Number.isFinite(limit) ? limit : undefined,
      cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
    });

    res.json({
      connectedAccounts: result.items,
      total: result.items.length,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/connected-accounts", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { authConfigId, externalUserId, connection, validateCredentials } = req.body as {
    authConfigId?: string;
    externalUserId?: string;
    connection?: Record<string, unknown>;
    validateCredentials?: boolean;
  };

  if (!authConfigId?.trim()) {
    res.status(400).json({ error: "authConfigId is required" });
    return;
  }

  if (!externalUserId?.trim()) {
    res.status(400).json({ error: "externalUserId is required" });
    return;
  }

  try {
    const connectedAccount = await composioConnectorService.createConnectedAccount(userId, {
      authConfigId: authConfigId.trim(),
      externalUserId: externalUserId.trim(),
      connection,
      validateCredentials,
    });

    res.status(201).json({ connectedAccount });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/connected-accounts/:id/refresh", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const refreshed = await composioConnectorService.refreshConnectedAccount(userId, {
      connectedAccountId: req.params.id,
      redirectUrl:
        typeof (req.body as { redirectUrl?: unknown }).redirectUrl === "string"
          ? ((req.body as { redirectUrl: string }).redirectUrl.trim() || undefined)
          : undefined,
      validateCredentials:
        typeof (req.body as { validateCredentials?: unknown }).validateCredentials === "boolean"
          ? (req.body as { validateCredentials: boolean }).validateCredentials
          : undefined,
    });

    res.json({ refreshed });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/triggers/active", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const parseCsv = (value: unknown): string[] | undefined =>
    typeof value === "string"
      ? value.split(",").map((item) => item.trim()).filter(Boolean)
      : undefined;
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;

  try {
    const triggers = await composioConnectorService.listActiveTriggers(userId, {
      connectedAccountIds: parseCsv(req.query.connectedAccountIds),
      triggerNames: parseCsv(req.query.triggerNames),
      limit: Number.isFinite(limit) ? limit : undefined,
    });

    res.json({ triggers, total: triggers.length });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/triggers/:slug/upsert", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { connectedAccountId, triggerConfig, toolkitVersions } = req.body as {
    connectedAccountId?: string;
    triggerConfig?: Record<string, unknown>;
    toolkitVersions?: string | Record<string, string>;
  };

  if (!connectedAccountId?.trim()) {
    res.status(400).json({ error: "connectedAccountId is required" });
    return;
  }

  try {
    const trigger = await composioConnectorService.upsertTrigger(userId, {
      slug: req.params.slug,
      connectedAccountId: connectedAccountId.trim(),
      triggerConfig,
      toolkitVersions,
    });

    res.status(201).json({ trigger });
  } catch (error) {
    handleError(res, error);
  }
});

export const composioWebhookRouter = express.Router();

composioWebhookRouter.post("/events", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const signingSecret = process.env.COMPOSIO_WEBHOOK_SECRET;
    if (!signingSecret) {
      throw new ConnectorError("auth", "COMPOSIO_WEBHOOK_SECRET is not configured", 503);
    }

    const rawBody = req.body as Buffer;
    verifyComposioWebhook({
      rawBody,
      signatureHeader: req.header("webhook-signature"),
      webhookIdHeader: req.header("webhook-id"),
      webhookTimestampHeader: req.header("webhook-timestamp"),
      signingSecret,
    });

    const payload = JSON.parse(rawBody.toString("utf8")) as ComposioWebhookEvent;

    logComposio({
      event: "webhook",
      level: "info",
      connector: "composio",
      message: "Composio webhook received",
      metadata: {
        type: payload.type,
        triggerSlug: payload.metadata?.trigger_slug,
        triggerId: payload.metadata?.trigger_id,
        connectedAccountId: payload.metadata?.connected_account_id,
      },
    });

    res.status(202).json({ received: true });
  } catch (error) {
    if (error instanceof ConnectorError) {
      res.status(error.statusCode).json({ error: error.message, type: error.type });
      return;
    }

    res.status(400).json({
      error: "Invalid Composio webhook payload",
      type: "schema",
    });
  }
});

export default router;
