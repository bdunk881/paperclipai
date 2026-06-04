import express from "express";
import { requireAuth, AuthenticatedRequest } from "../../auth/authMiddleware";
import { logIntercom } from "./logger";
import { intercomConnectorService } from "./service";
import { ConnectorError } from "./types";
import { verifyIntercomWebhook } from "./webhook";
import { asyncHandler } from "../../middleware/asyncHandler";

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
    error: "Unexpected Intercom connector error",
    type: "upstream",
  });
}

router.post("/oauth/start", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const flow = intercomConnectorService.beginOAuth(userId);
  res.status(201).json(flow);
});

router.get("/oauth/callback", asyncHandler(async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";

  if (!code || !state) {
    res.status(400).json({ error: "code and state are required" });
    return;
  }

  const credential = await intercomConnectorService.completeOAuth({ code, state });
  res.status(201).json({ connection: credential });
}));

router.post("/connect-api-key", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
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

  const connection = await intercomConnectorService.connectApiKey({ userId, apiKey: apiKey.trim() });
  res.status(201).json({ connection });
}));

router.get("/connections", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const connections = await intercomConnectorService.listConnections(userId);
  res.json({ connections, total: connections.length });
}));

router.post("/test-connection", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const result = await intercomConnectorService.testConnection(userId);
  res.json({ success: true, ...result });
}));

router.get("/health", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const health = await intercomConnectorService.health(userId);
  const statusCode = health.status === "ok" ? 200 : health.status === "degraded" ? 206 : 503;
  res.status(statusCode).json(health);
}));

router.delete("/connections/:id", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const deleted = await intercomConnectorService.disconnect(userId, req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Intercom connection not found" });
    return;
  }

  res.status(204).send();
}));

router.get("/contacts", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const contacts = await intercomConnectorService.listContacts(userId);
  res.json({ contacts, total: contacts.length });
}));

router.post("/contacts", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { email, name, role, externalId } = req.body as {
    email?: string;
    name?: string;
    role?: "lead" | "user";
    externalId?: string;
  };

  if (!email?.trim() && !externalId?.trim()) {
    res.status(400).json({ error: "email or externalId is required" });
    return;
  }

  const contact = await intercomConnectorService.createContact(userId, {
    email: email?.trim(),
    name: name?.trim() || undefined,
    role,
    externalId: externalId?.trim(),
  });

  res.status(201).json({ contact });
}));

router.patch("/contacts/:id", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const contactId = req.params.id;
  if (!contactId?.trim()) {
    res.status(400).json({ error: "contact id is required" });
    return;
  }

  const { email, name, role } = req.body as {
    email?: string;
    name?: string;
    role?: "lead" | "user";
  };

  if (!email && !name && !role) {
    res.status(400).json({ error: "At least one field must be provided" });
    return;
  }

  const contact = await intercomConnectorService.updateContact(userId, contactId, {
    email: email?.trim(),
    name: name?.trim() || undefined,
    role,
  });

  res.json({ contact });
}));

router.get("/conversations", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const conversations = await intercomConnectorService.listConversations(userId);
  res.json({ conversations, total: conversations.length });
}));

router.post("/conversations", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { fromContactId, body, messageType, assigneeId } = req.body as {
    fromContactId?: string;
    body?: string;
    messageType?: "comment" | "note";
    assigneeId?: string;
  };

  if (!fromContactId?.trim()) {
    res.status(400).json({ error: "fromContactId is required" });
    return;
  }

  if (!body?.trim()) {
    res.status(400).json({ error: "body is required" });
    return;
  }

  const conversation = await intercomConnectorService.createConversation(userId, {
    fromContactId: fromContactId.trim(),
    body: body.trim(),
    messageType,
    assigneeId: assigneeId?.trim() || undefined,
  });

  res.status(201).json({ conversation });
}));

router.post("/conversations/:id/reply", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const conversationId = req.params.id;
  if (!conversationId?.trim()) {
    res.status(400).json({ error: "conversation id is required" });
    return;
  }

  const { adminId, body, messageType } = req.body as {
    adminId?: string;
    body?: string;
    messageType?: "comment" | "note";
  };

  if (!adminId?.trim()) {
    res.status(400).json({ error: "adminId is required" });
    return;
  }

  if (!body?.trim()) {
    res.status(400).json({ error: "body is required" });
    return;
  }

  const conversation = await intercomConnectorService.replyToConversation(userId, conversationId, {
    adminId: adminId.trim(),
    body: body.trim(),
    messageType,
  });

  res.status(201).json({ conversation });
}));

export const intercomWebhookRouter = express.Router();

intercomWebhookRouter.post("/events", express.raw({ type: "application/json" }), (req, res) => {
  const signingSecret = process.env.INTERCOM_WEBHOOK_SECRET;
  if (!signingSecret) {
    throw new ConnectorError("auth", "INTERCOM_WEBHOOK_SECRET is not configured", 503);
  }

  const rawBody = req.body as Buffer;
  verifyIntercomWebhook({
    rawBody,
    signatureHeader: req.header("x-hub-signature-256") ?? req.header("x-hub-signature"),
    deliveryIdHeader: req.header("x-intercom-webhook-id") ?? req.header("x-request-id"),
    signingSecret,
  });

  const payload = JSON.parse(rawBody.toString("utf8"));

  logIntercom({
    event: "webhook",
    level: "info",
    connector: "intercom",
    message: "Intercom webhook received",
    metadata: {
      topic: payload?.topic,
      type: payload?.type,
      id: req.header("x-intercom-webhook-id") ?? req.header("x-request-id"),
    },
  });

  res.status(202).json({ received: true });
});

export default router;
