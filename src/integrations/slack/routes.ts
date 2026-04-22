import express from "express";
import { requireAuth, AuthenticatedRequest } from "../../auth/authMiddleware";
import { slackConnectorService } from "./service";
import { ConnectorError } from "./types";
import { logSlack } from "./logger";
import { verifySlackSignature } from "./webhook";

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
    error: "Unexpected Slack connector error",
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
    const flow = slackConnectorService.beginOAuth(userId);
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
    const credential = await slackConnectorService.completeOAuth({ code, state });
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

  const { botToken } = req.body as { botToken?: string };
  if (!botToken || !botToken.trim()) {
    res.status(400).json({ error: "botToken is required" });
    return;
  }

  try {
    const connection = await slackConnectorService.connectApiKey({ userId, botToken: botToken.trim() });
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

  const connections = slackConnectorService.listConnections(userId);
  res.json({ connections, total: connections.length });
});

router.post("/test-connection", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const result = await slackConnectorService.testConnection(userId);
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

  const health = await slackConnectorService.health(userId);
  const statusCode = health.status === "ok" ? 200 : health.status === "degraded" ? 206 : 503;
  res.status(statusCode).json(health);
});

router.delete("/connections/:id", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const deleted = slackConnectorService.disconnect(userId, req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Slack connection not found" });
    return;
  }

  res.status(204).send();
});

router.get("/channels", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const channels = await slackConnectorService.listChannels(userId);
    res.json({ channels, total: channels.length });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/channels/:channel/messages", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const messages = await slackConnectorService.listChannelMessages(userId, req.params.channel);
    res.json({ messages, total: messages.length });
  } catch (error) {
    handleError(res, error);
  }
});

export const slackWebhookRouter = express.Router();

slackWebhookRouter.post("/events", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (!signingSecret) {
      throw new ConnectorError("auth", "SLACK_SIGNING_SECRET is not configured", 503);
    }

    const rawBody = req.body as Buffer;
    verifySlackSignature({
      rawBody,
      signatureHeader: req.header("x-slack-signature"),
      timestampHeader: req.header("x-slack-request-timestamp"),
      signingSecret,
    });

    const payload = JSON.parse(rawBody.toString("utf8"));

    if (payload.type === "url_verification" && payload.challenge) {
      res.status(200).json({ challenge: payload.challenge });
      return;
    }

    logSlack({
      event: "webhook",
      level: "info",
      connector: "slack",
      message: "Slack event received",
      metadata: {
        eventType: payload.event?.type,
        teamId: payload.team_id,
      },
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    handleError(res, error);
  }
});

export default router;
