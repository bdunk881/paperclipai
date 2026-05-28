import express from "express";
import { requireAuth, AuthenticatedRequest } from "../auth/authMiddleware";
import { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import { notificationService } from "./service";
import { NotificationCadence, NotificationChannel, NotificationKind } from "./types";
import { asyncHandler } from "../middleware/asyncHandler";

const router = express.Router();

const CHANNELS: NotificationChannel[] = ["slack", "email", "sms"];
const KINDS: NotificationKind[] = ["approvals", "milestones", "kpi_alerts", "budget_alerts", "kill_switch"];
const CADENCES: NotificationCadence[] = ["off", "immediate", "daily", "weekly"];

function getUserId(req: AuthenticatedRequest): string | null {
  const value = req.auth?.sub;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requireUserId(req: AuthenticatedRequest, res: express.Response): string | null {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return null;
  }
  return userId;
}

function requireWorkspaceId(req: WorkspaceAwareRequest, res: express.Response): string | null {
  const resolvedValue = req.workspaceId?.trim() ?? "";
  const queryValue = typeof req.query.workspaceId === "string" ? req.query.workspaceId.trim() : "";
  const bodyValue =
    typeof (req.body as { workspaceId?: unknown } | undefined)?.workspaceId === "string"
      ? String((req.body as { workspaceId?: string }).workspaceId).trim()
      : "";
  const workspaceId = resolvedValue || queryValue || bodyValue;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return null;
  }
  return workspaceId;
}

router.get("/preferences", requireAuth, asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) {
    return;
  }
  const userId = requireUserId(req, res);
  if (!userId) {
    return;
  }

  const preferences = await notificationService.listPreferences(workspaceId, userId);
  res.json({ preferences, total: preferences.length });
}));

router.put("/preferences", requireAuth, asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) {
    return;
  }
  const userId = requireUserId(req, res);
  if (!userId) {
    return;
  }

  const { channel, kind, cadence, enabled, mutedUntil } = req.body as {
    channel?: NotificationChannel;
    kind?: NotificationKind;
    cadence?: NotificationCadence;
    enabled?: boolean;
    mutedUntil?: string | null;
  };

  if (!channel || !CHANNELS.includes(channel)) {
    res.status(400).json({ error: "Valid channel is required" });
    return;
  }
  if (!kind || !KINDS.includes(kind)) {
    res.status(400).json({ error: "Valid kind is required" });
    return;
  }
  if (!cadence || !CADENCES.includes(cadence)) {
    res.status(400).json({ error: "Valid cadence is required" });
    return;
  }

  const preference = await notificationService.updatePreference({
    workspaceId,
    userId,
    channel,
    kind,
    cadence,
    enabled,
    mutedUntil: mutedUntil ?? undefined,
  });
  res.json({ preference });
}));

router.get("/transports", requireAuth, asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) {
    return;
  }
  const userId = requireUserId(req, res);
  if (!userId) {
    return;
  }

  const transports = await notificationService.listTransportConfigs(workspaceId, userId);
  res.json({ transports, total: transports.length });
}));

router.put("/transports/:channel", requireAuth, asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) {
    return;
  }

  const userId = requireUserId(req, res);
  if (!userId) {
    return;
  }

  const channel = req.params.channel as NotificationChannel;
  if (!CHANNELS.includes(channel)) {
    res.status(400).json({ error: "Unknown channel" });
    return;
  }

  const { connectionId, enabled, config } = req.body as {
    connectionId?: string;
    enabled?: boolean;
    config?: Record<string, string>;
  };

  const transport = await notificationService.upsertTransportConfig({
    workspaceId,
    userId,
    channel,
    ownerUserId: userId,
    connectionId: connectionId?.trim() || undefined,
    enabled: enabled !== false,
    config: {
      slackChannelId: config?.slackChannelId?.trim() || undefined,
      slackChannelName: config?.slackChannelName?.trim() || undefined,
      recipientEmail: config?.recipientEmail?.trim() || undefined,
      fromEmail: config?.fromEmail?.trim() || undefined,
      fromName: config?.fromName?.trim() || undefined,
      toPhone: config?.toPhone?.trim() || undefined,
      fromPhone: config?.fromPhone?.trim() || undefined,
    },
  });

  res.json({ transport });
}));

router.post("/events", requireAuth, asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) {
    return;
  }
  const userId = requireUserId(req, res);
  if (!userId) {
    return;
  }

  const { kind, title, summary, severity, source, metadata } = req.body as {
    kind?: NotificationKind;
    title?: string;
    summary?: string;
    severity?: "info" | "warning" | "critical";
    source?: string;
    metadata?: Record<string, unknown>;
  };

  if (!kind || !KINDS.includes(kind)) {
    res.status(400).json({ error: "Valid kind is required" });
    return;
  }
  if (!title?.trim() || !summary?.trim()) {
    res.status(400).json({ error: "title and summary are required" });
    return;
  }

  const event = await notificationService.recordEvent({
    workspaceId,
    userId,
    kind,
    title: title.trim(),
    summary: summary.trim(),
    severity,
    source: source?.trim(),
    metadata,
  });
  res.status(201).json({ event });
}));

router.post("/test-send", requireAuth, asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) {
    return;
  }
  const userId = requireUserId(req, res);
  if (!userId) {
    return;
  }

  const kind = req.body.kind as NotificationKind | undefined;
  if (!kind || !KINDS.includes(kind)) {
    res.status(400).json({ error: "Valid kind is required" });
    return;
  }

  const event = await notificationService.sendTestEvent({
    workspaceId,
    userId,
    kind,
    title: typeof req.body.title === "string" ? req.body.title : undefined,
    summary: typeof req.body.summary === "string" ? req.body.summary : undefined,
  });
  res.status(202).json({ event, accepted: true });
}));

router.post("/sweep", requireAuth, asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) {
    return;
  }
  const userId = requireUserId(req, res);
  if (!userId) {
    return;
  }

  const result = await notificationService.runSweepForWorkspace(workspaceId, userId);
  res.json(result);
}));

router.get("/health", requireAuth, asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) {
    return;
  }
  const userId = requireUserId(req, res);
  if (!userId) {
    return;
  }

  const health = await notificationService.health(workspaceId, userId);
  const ok = health.channels.every((item) => !item.enabled || item.configured);
  res.status(ok ? 200 : 206).json(health);
}));

export default router;
