import express from "express";
import { requireAuth, AuthenticatedRequest } from "../../auth/authMiddleware";
import { getTier1HealthHttpStatus } from "../shared/tier1Contract";
import { apolloConnectorService } from "./service";
import { ConnectorError } from "./types";
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
    error: "Unexpected Apollo connector error",
    type: "upstream",
  });
}

router.post("/oauth/start", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const flow = apolloConnectorService.beginOAuth(userId);
  res.status(201).json(flow);
});

router.get("/oauth/callback", asyncHandler(async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";

  if (!code || !state) {
    res.status(400).json({ error: "code and state are required" });
    return;
  }

  const credential = await apolloConnectorService.completeOAuth({ code, state });
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

  const connection = await apolloConnectorService.connectApiKey({ userId, apiKey: apiKey.trim() });
  res.status(201).json({ connection });
}));

router.get("/connections", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const connections = await apolloConnectorService.listConnections(userId);
  res.json({ connections, total: connections.length });
}));

router.post("/test-connection", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const result = await apolloConnectorService.testConnection(userId);
  res.json({ success: true, ...result });
}));

router.get("/health", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const health = await apolloConnectorService.health(userId);
  res.status(getTier1HealthHttpStatus(health.status)).json(health);
}));

router.delete("/connections/:id", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const deleted = await apolloConnectorService.disconnect(userId, req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Apollo connection not found" });
    return;
  }

  res.status(204).send();
}));

export default router;
