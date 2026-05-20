import express from "express";
import { requireAuth, AuthenticatedRequest } from "../../auth/authMiddleware";
import { getTier1HealthHttpStatus } from "../shared/tier1Contract";
import { logLinear } from "./logger";
import { linearConnectorService } from "./service";
import { ConnectorError } from "./types";
import { verifyLinearWebhook } from "./webhook";
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
    error: "Unexpected Linear connector error",
    type: "upstream",
  });
}

router.post("/oauth/start", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const flow = linearConnectorService.beginOAuth(userId);
  res.status(201).json(flow);
});

router.get("/oauth/callback", asyncHandler(async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";

  if (!code || !state) {
    res.status(400).json({ error: "code and state are required" });
    return;
  }

  const credential = await linearConnectorService.completeOAuth({ code, state });
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

  const connection = await linearConnectorService.connectApiKey({ userId, apiKey: apiKey.trim() });
  res.status(201).json({ connection });
}));

router.get("/connections", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const connections = linearConnectorService.listConnections(userId);
  res.json({ connections, total: connections.length });
});

router.post("/test-connection", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const result = await linearConnectorService.testConnection(userId);
  res.json({ success: true, ...result });
}));

router.get("/health", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const health = await linearConnectorService.health(userId);
  res.status(getTier1HealthHttpStatus(health.status)).json(health);
}));

router.delete("/connections/:id", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const deleted = linearConnectorService.disconnect(userId, req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Linear connection not found" });
    return;
  }

  res.status(204).send();
});

router.get("/projects", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const projects = await linearConnectorService.listProjects(userId);
  res.json({ projects, total: projects.length });
}));

router.get("/issues", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const issues = await linearConnectorService.listIssues(userId);
  res.json({ issues, total: issues.length });
}));

router.post("/issues", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { title, description, teamId, projectId } = req.body as {
    title?: string;
    description?: string;
    teamId?: string;
    projectId?: string;
  };

  if (!title || !title.trim()) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  const issue = await linearConnectorService.createIssue(userId, {
    title: title.trim(),
    description,
    teamId,
    projectId,
  });
  res.status(201).json({ issue });
}));

router.patch("/issues/:id", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const issueId = req.params.id;
  if (!issueId?.trim()) {
    res.status(400).json({ error: "issue id is required" });
    return;
  }

  const { title, description, stateId, projectId } = req.body as {
    title?: string;
    description?: string;
    stateId?: string;
    projectId?: string;
  };

  if (!title && !description && !stateId && !projectId) {
    res.status(400).json({ error: "At least one field must be provided" });
    return;
  }

  const issue = await linearConnectorService.updateIssue(userId, issueId, {
    title,
    description,
    stateId,
    projectId,
  });
  res.status(200).json({ issue });
}));

export const linearWebhookRouter = express.Router();

linearWebhookRouter.post("/events", express.raw({ type: "application/json" }), (req, res) => {
  const signingSecret = process.env.LINEAR_WEBHOOK_SECRET;
  if (!signingSecret) {
    throw new ConnectorError("auth", "LINEAR_WEBHOOK_SECRET is not configured", 503);
  }

  const rawBody = req.body as Buffer;
  try {
    verifyLinearWebhook({
      rawBody,
      signatureHeader: req.header("linear-signature") ?? req.header("x-linear-signature"),
      deliveryIdHeader: req.header("linear-delivery") ?? req.header("x-linear-delivery"),
      signingSecret,
    });
  } catch (verifyErr) {
    console.error("[webhook.signature_rejected]", { provider: "linear", ip: req.ip, error: verifyErr instanceof Error ? verifyErr.message : String(verifyErr) });
    throw verifyErr;
  }

  const payload = JSON.parse(rawBody.toString("utf8"));

  logLinear({
    event: "webhook",
    level: "info",
    connector: "linear",
    message: "Linear webhook received",
    metadata: {
      action: payload.action,
      type: payload.type,
      createdAt: payload.createdAt,
    },
  });

  res.status(200).json({ ok: true });
});

export default router;
