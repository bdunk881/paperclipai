import express from "express";
import { requireAuth, AuthenticatedRequest } from "../../auth/authMiddleware";
import { getTier1HealthHttpStatus } from "../shared/tier1Contract";
import { logTeams } from "./logger";
import { teamsConnectorService } from "./service";
import { ConnectorError } from "./types";
import { verifyTeamsWebhook } from "./webhook";

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
    error: "Unexpected Microsoft Teams connector error",
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
    const flow = teamsConnectorService.beginOAuth(userId);
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
    const credential = await teamsConnectorService.completeOAuth({ code, state });
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

  const { accessToken } = req.body as { accessToken?: string };
  if (!accessToken || !accessToken.trim()) {
    res.status(400).json({ error: "accessToken is required" });
    return;
  }

  try {
    const connection = await teamsConnectorService.connectApiKey({ userId, apiKey: accessToken.trim() });
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

  const connections = teamsConnectorService.listConnections(userId);
  res.json({ connections, total: connections.length });
});

router.post("/test-connection", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const result = await teamsConnectorService.testConnection(userId);
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

  const health = await teamsConnectorService.health(userId);
  res.status(getTier1HealthHttpStatus(health.status)).json(health);
});

router.delete("/connections/:id", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const deleted = teamsConnectorService.disconnect(userId, req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Microsoft Teams connection not found" });
    return;
  }

  res.status(204).send();
});

router.get("/teams", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const teams = await teamsConnectorService.listTeams(userId);
    res.json({ teams, total: teams.length });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/chats", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const chats = await teamsConnectorService.listChats(userId);
    res.json({ chats, total: chats.length });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/teams/:teamId/channels/:channelId/messages", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { teamId, channelId } = req.params;
  if (!teamId?.trim() || !channelId?.trim()) {
    res.status(400).json({ error: "teamId and channelId are required" });
    return;
  }

  try {
    const messages = await teamsConnectorService.listChannelMessages(userId, teamId, channelId);
    res.json({ messages, total: messages.length });
  } catch (error) {
    handleError(res, error);
  }
});

export const teamsWebhookRouter = express.Router();

teamsWebhookRouter.post("/events", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const validationToken = typeof req.query.validationToken === "string"
      ? req.query.validationToken
      : null;

    if (validationToken) {
      res.status(200).type("text/plain").send(validationToken);
      return;
    }

    const clientStateSecret = process.env.TEAMS_WEBHOOK_CLIENT_STATE;
    if (!clientStateSecret) {
      throw new ConnectorError("auth", "TEAMS_WEBHOOK_CLIENT_STATE is not configured", 503);
    }

    const rawBody = req.body as Buffer;
    const payload = JSON.parse(rawBody.toString("utf8")) as {
      value?: Array<{
        id?: string;
        subscriptionId?: string;
        clientState?: string;
        resource?: string;
        changeType?: string;
      }>;
    };

    const notifications = Array.isArray(payload.value) ? payload.value : [];
    verifyTeamsWebhook({
      notifications,
      expectedClientState: clientStateSecret,
    });

    for (const notification of notifications) {
      logTeams({
        event: "webhook",
        level: "info",
        connector: "microsoft-teams",
        message: "Teams webhook received",
        metadata: {
          notificationId: notification.id,
          subscriptionId: notification.subscriptionId,
          resource: notification.resource,
          changeType: notification.changeType,
        },
      });
    }

    res.status(202).json({ ok: true });
  } catch (error) {
    handleError(res, error);
  }
});

export default router;
