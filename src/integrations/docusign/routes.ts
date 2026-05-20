import express from "express";
import { requireAuth, AuthenticatedRequest } from "../../auth/authMiddleware";
import { docuSignConnectorService } from "./service";
import { ConnectorError } from "./types";
import { logDocuSign } from "./logger";
import { verifyDocuSignWebhook } from "./webhook";
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
    error: "Unexpected DocuSign connector error",
    type: "upstream",
  });
}

router.post("/oauth/start", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const flow = docuSignConnectorService.beginOAuth(userId);
  res.status(201).json(flow);
});

router.get("/oauth/callback", asyncHandler(async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";

  if (!code || !state) {
    res.status(400).json({ error: "code and state are required" });
    return;
  }

  const credential = await docuSignConnectorService.completeOAuth({ code, state });
  res.status(201).json({ connection: credential });
}));

router.post("/connect-api-key", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { accessToken, accountId, baseUri, scopes, accountName } = req.body as {
    accessToken?: string;
    accountId?: string;
    baseUri?: string;
    scopes?: string[];
    accountName?: string;
  };

  if (!accessToken || !accessToken.trim()) {
    res.status(400).json({ error: "accessToken is required" });
    return;
  }
  if (!accountId || !accountId.trim()) {
    res.status(400).json({ error: "accountId is required" });
    return;
  }
  if (!baseUri || !baseUri.trim()) {
    res.status(400).json({ error: "baseUri is required" });
    return;
  }

  const connection = await docuSignConnectorService.connectApiKey({
    userId,
    accessToken: accessToken.trim(),
    accountId: accountId.trim(),
    baseUri: baseUri.trim(),
    scopes: Array.isArray(scopes) ? scopes.filter((item): item is string => typeof item === "string") : undefined,
    accountName: typeof accountName === "string" ? accountName : undefined,
  });
  res.status(201).json({ connection });
}));

router.get("/connections", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const connections = docuSignConnectorService.listConnections(userId);
  res.json({ connections, total: connections.length });
});

router.post("/test-connection", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const result = await docuSignConnectorService.testConnection(userId);
  res.json({ success: true, ...result });
}));

router.get("/health", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const health = await docuSignConnectorService.health(userId);
  const statusCode = health.status === "ok" ? 200 : health.status === "degraded" ? 206 : 503;
  res.status(statusCode).json(health);
}));

router.delete("/connections/:id", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const deleted = docuSignConnectorService.disconnect(userId, req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "DocuSign connection not found" });
    return;
  }

  res.status(204).send();
});

router.get("/envelopes", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const envelopes = await docuSignConnectorService.listEnvelopes(userId);
  res.json({ envelopes, total: envelopes.length });
}));

router.post("/envelopes", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { envelopeDefinition } = req.body as {
    envelopeDefinition?: Record<string, unknown>;
  };

  if (!envelopeDefinition || typeof envelopeDefinition !== "object" || Array.isArray(envelopeDefinition)) {
    res.status(400).json({ error: "envelopeDefinition is required" });
    return;
  }

  const envelope = await docuSignConnectorService.createEnvelope(userId, envelopeDefinition);
  res.status(201).json({ envelope });
}));

router.get("/envelopes/:id", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const envelope = await docuSignConnectorService.getEnvelope(userId, req.params.id);
  res.json({ envelope });
}));

export const docuSignWebhookRouter = express.Router();

docuSignWebhookRouter.post("/connect", express.raw({ type: "application/json" }), (req, res) => {
  const signingSecret = process.env.DOCUSIGN_WEBHOOK_SECRET;
  if (!signingSecret) {
    throw new ConnectorError("auth", "DOCUSIGN_WEBHOOK_SECRET is not configured", 503);
  }

  const rawBody = req.body as Buffer;
  verifyDocuSignWebhook({
    rawBody,
    signatureHeader: req.header("x-docusign-signature-1") ?? undefined,
    deliveryIdHeader: req.header("x-docusign-delivery-id") ?? undefined,
    signingSecret,
  });

  const payload = JSON.parse(rawBody.toString("utf8"));

  logDocuSign({
    event: "webhook",
    level: "info",
    connector: "docusign",
    message: "DocuSign connect event received",
    metadata: {
      envelopeId: payload?.data?.envelopeId,
      deliveryId: req.header("x-docusign-delivery-id") ?? undefined,
    },
  });

  res.status(200).json({ ok: true });
});

export default router;
