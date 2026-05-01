import express from "express";
import { AuthenticatedRequest, requireAuth } from "../../auth/authMiddleware";
import { getTier1HealthHttpStatus } from "../shared/tier1Contract";
import { gmailConnectorService } from "./service";
import { logGmail } from "./logger";
import { ConnectorError } from "./types";
import { verifyGooglePubSubPush } from "./webhook";

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
    error: "Unexpected Gmail connector error",
    type: "upstream",
  });
}

function parseLimit(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined;
}

function parseCsvParam(value: unknown): string[] | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const parts = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts : undefined;
}

router.post("/oauth/start", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const flow = gmailConnectorService.beginOAuth(userId);
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
    const credential = await gmailConnectorService.completeOAuth({ code, state });
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

  const body = req.body as { apiKey?: string; accessToken?: string };
  const apiKey = body.apiKey ?? body.accessToken;
  if (!apiKey || !apiKey.trim()) {
    res.status(400).json({ error: "apiKey or accessToken is required" });
    return;
  }

  try {
    const connection = await gmailConnectorService.connectApiKey({
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

  const connections = await gmailConnectorService.listConnections(userId);
  res.json({ connections, total: connections.length });
});

router.post("/test-connection", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const result = await gmailConnectorService.testConnection(userId);
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

  const health = await gmailConnectorService.health(userId);
  res.status(getTier1HealthHttpStatus(health.status)).json(health);
});

router.delete("/connections/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const deleted = await gmailConnectorService.disconnect(userId, req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Gmail connection not found" });
    return;
  }

  res.status(204).send();
});

router.get("/messages", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const messages = await gmailConnectorService.listMessages(userId, {
      query: typeof req.query.q === "string" ? req.query.q.trim() : undefined,
      labelIds: parseCsvParam(req.query.labelIds),
      maxResults: parseLimit(req.query.maxResults),
    });
    res.json({ messages, total: messages.length });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/messages/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const message = await gmailConnectorService.getMessage(userId, req.params.id);
    res.json({ message });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/messages/send", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { to, subject, text, html, cc, bcc, threadId } = req.body as {
    to?: string;
    subject?: string;
    text?: string;
    html?: string;
    cc?: string[];
    bcc?: string[];
    threadId?: string;
  };

  if (!to?.trim() || !subject?.trim() || !text?.trim()) {
    res.status(400).json({ error: "to, subject, and text are required" });
    return;
  }

  try {
    const message = await gmailConnectorService.sendMessage(userId, {
      to: to.trim(),
      subject: subject.trim(),
      text: text.trim(),
      html: html?.trim(),
      cc: Array.isArray(cc) ? cc.map((value) => String(value).trim()).filter(Boolean) : undefined,
      bcc: Array.isArray(bcc) ? bcc.map((value) => String(value).trim()).filter(Boolean) : undefined,
      threadId: threadId?.trim(),
    });
    res.status(201).json({ message });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/labels", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const labels = await gmailConnectorService.listLabels(userId);
    res.json({ labels, total: labels.length });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/labels", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { name, messageListVisibility, labelListVisibility, color } = req.body as {
    name?: string;
    messageListVisibility?: string;
    labelListVisibility?: string;
    color?: {
      textColor?: string;
      backgroundColor?: string;
    };
  };

  if (!name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  try {
    const label = await gmailConnectorService.createLabel(userId, {
      name: name.trim(),
      messageListVisibility,
      labelListVisibility,
      color,
    });
    res.status(201).json({ label });
  } catch (error) {
    handleError(res, error);
  }
});

router.patch("/labels/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { name, messageListVisibility, labelListVisibility, color } = req.body as {
    name?: string;
    messageListVisibility?: string;
    labelListVisibility?: string;
    color?: {
      textColor?: string;
      backgroundColor?: string;
    };
  };

  if (!name && !messageListVisibility && !labelListVisibility && !color) {
    res.status(400).json({ error: "At least one field must be provided" });
    return;
  }

  try {
    const label = await gmailConnectorService.updateLabel(userId, req.params.id, {
      name: name?.trim(),
      messageListVisibility,
      labelListVisibility,
      color,
    });
    res.json({ label });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/watch", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { topicName, labelIds, labelFilterAction } = req.body as {
    topicName?: string;
    labelIds?: string[];
    labelFilterAction?: "include" | "exclude";
  };

  const effectiveTopicName = topicName?.trim() || process.env.GMAIL_PUBSUB_TOPIC?.trim();
  if (!effectiveTopicName) {
    res.status(400).json({ error: "topicName is required or set GMAIL_PUBSUB_TOPIC" });
    return;
  }

  try {
    const watch = await gmailConnectorService.watchMailbox(userId, {
      topicName: effectiveTopicName,
      labelIds: Array.isArray(labelIds) ? labelIds.map((value) => String(value).trim()).filter(Boolean) : undefined,
      labelFilterAction,
    });
    res.status(201).json({ watch });
  } catch (error) {
    handleError(res, error);
  }
});

export const gmailWebhookRouter = express.Router();

gmailWebhookRouter.post(
  "/pubsub",
  express.json({ type: ["application/json", "application/*+json"] }),
  async (req, res) => {
    try {
      const notification = await verifyGooglePubSubPush({
        authorizationHeader: req.header("authorization"),
        body: req.body,
      });

      logGmail({
        event: "webhook",
        level: "info",
        connector: "gmail",
        emailAddress: notification.emailAddress,
        message: "Gmail Pub/Sub notification received",
        metadata: {
          messageId: notification.messageId,
          historyId: notification.historyId,
          publishTime: notification.publishTime,
          subscription: notification.subscription,
        },
      });

      res.status(200).json({ ok: true });
    } catch (error) {
      handleError(res, error);
    }
  }
);

export default router;
