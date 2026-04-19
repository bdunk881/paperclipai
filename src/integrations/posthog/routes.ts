import express from "express";
import { requireAuth, AuthenticatedRequest } from "../../auth/authMiddleware";
import { logPostHog } from "./logger";
import { posthogConnectorService } from "./service";
import { ConnectorError } from "./types";
import { verifyPostHogWebhook } from "./webhook";

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
    error: "Unexpected PostHog connector error",
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
    const flow = posthogConnectorService.beginOAuth(userId);
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
    const credential = await posthogConnectorService.completeOAuth({ code, state });
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
    const connection = await posthogConnectorService.connectApiKey({ userId, apiKey: apiKey.trim() });
    res.status(201).json({ connection });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/connections", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const connections = posthogConnectorService.listConnections(userId);
  res.json({ connections, total: connections.length });
});

router.post("/test-connection", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const result = await posthogConnectorService.testConnection(userId);
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

  const health = await posthogConnectorService.health(userId);
  const statusCode = health.status === "ok" ? 200 : health.status === "degraded" ? 206 : 503;
  res.status(statusCode).json(health);
});

router.delete("/connections/:id", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const deleted = posthogConnectorService.disconnect(userId, req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "PostHog connection not found" });
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
    const projects = await posthogConnectorService.listProjects(userId);
    res.json({ projects, total: projects.length });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/feature-flags", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;

  try {
    const flags = await posthogConnectorService.listFeatureFlags(userId, projectId);
    res.json({ flags, total: flags.length });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/events", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { event, distinctId, properties, projectApiKey, timestamp } = req.body as {
    event?: string;
    distinctId?: string;
    properties?: Record<string, unknown>;
    projectApiKey?: string;
    timestamp?: string;
  };

  if (!event || !event.trim()) {
    res.status(400).json({ error: "event is required" });
    return;
  }

  if (!distinctId || !distinctId.trim()) {
    res.status(400).json({ error: "distinctId is required" });
    return;
  }

  try {
    const capture = await posthogConnectorService.captureEvent(userId, {
      event: event.trim(),
      distinctId: distinctId.trim(),
      properties,
      projectApiKey: projectApiKey?.trim() || undefined,
      timestamp,
    });

    res.status(201).json({ capture });
  } catch (error) {
    handleError(res, error);
  }
});

export const posthogWebhookRouter = express.Router();

posthogWebhookRouter.post("/events", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const signingSecret = process.env.POSTHOG_WEBHOOK_SECRET;
    if (!signingSecret) {
      throw new ConnectorError("auth", "POSTHOG_WEBHOOK_SECRET is not configured", 503);
    }

    const rawBody = req.body as Buffer;
    verifyPostHogWebhook({
      rawBody,
      signatureHeader: req.header("posthog-signature") ?? req.header("x-posthog-signature"),
      deliveryIdHeader: req.header("posthog-delivery") ?? req.header("x-posthog-delivery"),
      signingSecret,
    });

    const payload = JSON.parse(rawBody.toString("utf8"));

    logPostHog({
      event: "webhook",
      level: "info",
      connector: "posthog",
      message: "PostHog webhook received",
      metadata: {
        event: payload?.event,
        deliveryId: req.header("posthog-delivery") ?? req.header("x-posthog-delivery"),
      },
    });

    res.status(202).json({ received: true });
  } catch (error) {
    if (error instanceof ConnectorError) {
      res.status(error.statusCode).json({ error: error.message, type: error.type });
      return;
    }

    res.status(400).json({
      error: "Invalid PostHog webhook payload",
      type: "schema",
    });
  }
});

export default router;
