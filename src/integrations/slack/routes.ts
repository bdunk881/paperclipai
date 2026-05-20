import express from "express";
import { requireAuth, AuthenticatedRequest } from "../../auth/authMiddleware";
import { asyncHandler } from "../../middleware/asyncHandler";
import { getTier1HealthHttpStatus } from "../shared/tier1Contract";
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

  const flow = slackConnectorService.beginOAuth(userId);
  res.status(201).json(flow);
});

router.get("/oauth/callback", asyncHandler(async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";

  if (!code || !state) {
    res.status(400).json({ error: "code and state are required" });
    return;
  }

  const credential = await slackConnectorService.completeOAuth({ code, state });
  res.status(201).json({ connection: credential });
}));

router.post("/connect-api-key", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
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

  const connection = await slackConnectorService.connectApiKey({ userId, botToken: botToken.trim() });
  res.status(201).json({ connection });
}));

router.get(
  "/connections",
  requireAuth,
  // HEL-183: `asyncHandler` routes any rejection through the global
  // typed-error middleware (`src/app.ts`), which renders
  // `Tier1ConnectorError` subclasses with their `statusCode` + `type`.
  // Replaces the manual try/catch + handleError pattern Codex flagged
  // on #926.
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: "Authenticated user required" });
      return;
    }
    const connections = await slackConnectorService.listConnections(userId);
    res.json({ connections, total: connections.length });
  }),
);

router.post("/test-connection", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const result = await slackConnectorService.testConnection(userId);
  res.json({ success: true, ...result });
}));

router.get("/health", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const health = await slackConnectorService.health(userId);
  res.status(getTier1HealthHttpStatus(health.status)).json(health);
}));

router.delete(
  "/connections/:id",
  requireAuth,
  // HEL-183: same pattern as `/connections` above — `asyncHandler` plus
  // the global typed-error middleware (`src/app.ts`) replace the manual
  // try/catch + handleError that Codex flagged on #926.
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: "Authenticated user required" });
      return;
    }
    const deleted = await slackConnectorService.disconnect(userId, req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Slack connection not found" });
      return;
    }
    res.status(204).send();
  }),
);

router.get("/channels", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const channels = await slackConnectorService.listChannels(userId);
  res.json({ channels, total: channels.length });
}));

router.get("/channels/:channel/messages", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const messages = await slackConnectorService.listChannelMessages(userId, req.params.channel);
  res.json({ messages, total: messages.length });
}));

export const slackWebhookRouter = express.Router();

slackWebhookRouter.post("/events", express.raw({ type: "application/json" }), (req, res) => {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    throw new ConnectorError("auth", "SLACK_SIGNING_SECRET is not configured", 503);
  }

  const rawBody = req.body as Buffer;
  try {
    verifySlackSignature({
      rawBody,
      signatureHeader: req.header("x-slack-signature"),
      timestampHeader: req.header("x-slack-request-timestamp"),
      signingSecret,
    });
  } catch (verifyErr) {
    console.error("[webhook.signature_rejected]", { provider: "slack", ip: req.ip, error: verifyErr instanceof Error ? verifyErr.message : String(verifyErr) });
    throw verifyErr;
  }

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
});

export default router;
