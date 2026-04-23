import express from "express";
import { requireAuth, AuthenticatedRequest } from "../../auth/authMiddleware";
import { logSentry } from "./logger";
import { sentryConnectorService } from "./service";
import { ConnectorError } from "./types";
import { verifySentryWebhook } from "./webhook";

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
    error: "Unexpected Sentry connector error",
    type: "upstream",
  });
}

router.post("/oauth/start", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const flow = sentryConnectorService.beginOAuth(userId);
    res.status(201).json(flow);
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/oauth/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";

  if (!code || !state) {
    res.status(400).json({ error: "code and state are required" });
    return;
  }

  try {
    const credential = await sentryConnectorService.completeOAuth({ code, state });
    res.status(201).json({ connection: credential });
  } catch (error) {
    handleError(res, error);
  }
});

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
    const connection = await sentryConnectorService.connectApiKey({ userId, apiKey: apiKey.trim() });
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

  const connections = await sentryConnectorService.listConnections(userId);
  res.json({ connections, total: connections.length });
});

router.post("/test-connection", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const result = await sentryConnectorService.testConnection(userId);
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

  const health = await sentryConnectorService.health(userId);
  const statusCode = health.status === "ok" ? 200 : health.status === "degraded" ? 206 : 503;
  res.status(statusCode).json(health);
});

router.delete("/connections/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const deleted = await sentryConnectorService.disconnect(userId, req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Sentry connection not found" });
    return;
  }

  res.status(204).send();
});

router.get("/projects", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const projects = await sentryConnectorService.listProjects(userId);
    res.json({ projects, total: projects.length });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/issues", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const projectSlug = typeof req.query.projectSlug === "string" ? req.query.projectSlug.trim() : undefined;
  const query = typeof req.query.query === "string" ? req.query.query.trim() : undefined;
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;

  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    res.status(400).json({ error: "limit must be a positive number" });
    return;
  }

  try {
    const issues = await sentryConnectorService.listIssues(userId, {
      projectSlug: projectSlug || undefined,
      query: query || undefined,
      limit: limit ? Math.floor(limit) : undefined,
    });
    res.json({ issues, total: issues.length });
  } catch (error) {
    handleError(res, error);
  }
});

export const sentryWebhookRouter = express.Router();

sentryWebhookRouter.post("/events", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const sentryClientSecret = process.env.SENTRY_CLIENT_SECRET;
    if (!sentryClientSecret) {
      throw new ConnectorError("auth", "SENTRY_CLIENT_SECRET is not configured", 503);
    }

    const rawBody = req.body as Buffer;
    verifySentryWebhook({
      rawBody,
      signatureHeader: req.header("sentry-hook-signature") ?? undefined,
      hookIdHeader: req.header("sentry-hook-id") ?? undefined,
      resourceHeader: req.header("sentry-hook-resource") ?? undefined,
      eventIdHeader: req.header("sentry-hook-event") ?? req.header("sentry-hook-event-id") ?? undefined,
      sentryClientSecret,
    });

    const payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;

    logSentry({
      event: "webhook",
      level: "info",
      connector: "sentry",
      message: "Sentry webhook received",
      metadata: {
        resource: req.header("sentry-hook-resource") ?? undefined,
        action: req.header("sentry-hook-action") ?? undefined,
        installation: req.header("sentry-hook-id") ?? undefined,
        payloadKeys: Object.keys(payload),
      },
    });

    res.status(202).json({ received: true });
  } catch (error) {
    handleError(res, error);
  }
});

export default router;
