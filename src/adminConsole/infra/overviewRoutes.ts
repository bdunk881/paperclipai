/**
 * Infra dashboard Overview reads (HEL infra PR #2).
 *
 * Mounted under /api/admin-console/infra/overview. Returns status pills
 * for every surface plus the most recent infra-related audit rows so the
 * landing page answers "is anything on fire?" without further drilldown.
 *
 * Status pill semantics:
 *   ok      — surface is configured + reachable
 *   warn    — configured but with degraded info (e.g. error in last 24h)
 *   error   — configured but unreachable / 5xx
 *   unknown — not configured for this environment (e.g. no FLY_API_TOKEN)
 */

import { Router } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../../middleware/asyncHandler";
import { recordAdminAction } from "../auditLog";
import { extractAuditContext, type PlatformAdminRequest } from "../types";
import {
  getAgentPromptQueue,
  getDlqQueue,
  getRunQueue,
} from "../../queue/queues";
import { checkRedisConnection, isRedisConfigured } from "../../queue/redisClient";
import { getPostgresPool } from "../../db/postgres";
import { getConfiguredFlyApps, listMachinesForApps } from "./clients/flyClient";

export type StatusLevel = "ok" | "warn" | "error" | "unknown";

interface StatusPill {
  id: string;
  label: string;
  level: StatusLevel;
  detail?: string;
}

interface AuditRow {
  id: string;
  admin_user_id: string;
  action: string;
  reason: string | null;
  occurred_at: string;
  payload: Record<string, unknown>;
}

const INFRA_AUDIT_ACTIONS = [
  "view_infra_overview",
  "view_infra_compute",
  "create_agent_webhook",
  "update_agent_webhook",
  "disable_agent_webhook",
  "delete_agent_webhook",
  "test_agent_webhook",
  "ask_agent",
];

async function postgresPill(): Promise<StatusPill> {
  const pool = getPostgresPool();
  if (!pool) {
    return { id: "postgres", label: "Postgres", level: "unknown", detail: "not configured" };
  }
  try {
    await pool.query("SELECT 1");
    return { id: "postgres", label: "Postgres", level: "ok" };
  } catch (err) {
    return {
      id: "postgres",
      label: "Postgres",
      level: "error",
      detail: err instanceof Error ? err.message.slice(0, 80) : String(err),
    };
  }
}

async function redisPill(): Promise<StatusPill> {
  if (!isRedisConfigured()) {
    return { id: "redis", label: "Redis", level: "unknown", detail: "not configured" };
  }
  const ok = await checkRedisConnection();
  return ok
    ? { id: "redis", label: "Redis", level: "ok" }
    : { id: "redis", label: "Redis", level: "error", detail: "unreachable" };
}

async function queuesPill(): Promise<StatusPill> {
  const queues = [getRunQueue(), getDlqQueue(), getAgentPromptQueue()];
  if (queues.every((q) => q === null)) {
    return { id: "queues", label: "BullMQ", level: "unknown", detail: "no Redis" };
  }
  const dlq = getDlqQueue();
  if (!dlq) return { id: "queues", label: "BullMQ", level: "ok" };
  try {
    const counts = await dlq.getJobCounts("failed", "waiting");
    const stuck = (counts.failed ?? 0) + (counts.waiting ?? 0);
    if (stuck === 0) return { id: "queues", label: "BullMQ", level: "ok" };
    return {
      id: "queues",
      label: "BullMQ",
      level: stuck > 50 ? "error" : "warn",
      detail: `${stuck} job${stuck === 1 ? "" : "s"} in DLQ`,
    };
  } catch (err) {
    return {
      id: "queues",
      label: "BullMQ",
      level: "error",
      detail: err instanceof Error ? err.message.slice(0, 80) : String(err),
    };
  }
}

async function flyPill(): Promise<StatusPill[]> {
  const apps = getConfiguredFlyApps();
  if (!process.env.FLY_API_TOKEN) {
    return apps.map((app) => ({
      id: `fly:${app}`,
      label: app,
      level: "unknown" as const,
      detail: "FLY_API_TOKEN not configured",
    }));
  }
  const views = await listMachinesForApps(apps).catch(() =>
    apps.map((app) => ({ appName: app, machines: [], error: "Fly API unreachable" })),
  );
  return views.map((v) => {
    if (v.error) {
      return {
        id: `fly:${v.appName}`,
        label: v.appName,
        level: "error" as const,
        detail: v.error.slice(0, 80),
      };
    }
    if (v.machines.length === 0) {
      return {
        id: `fly:${v.appName}`,
        label: v.appName,
        level: "warn" as const,
        detail: "no machines",
      };
    }
    const bad = v.machines.filter((m) => m.state !== "started" && m.state !== "stopped");
    if (bad.length > 0) {
      return {
        id: `fly:${v.appName}`,
        label: v.appName,
        level: "warn" as const,
        detail: `${bad.length}/${v.machines.length} not started`,
      };
    }
    return {
      id: `fly:${v.appName}`,
      label: v.appName,
      level: "ok" as const,
      detail: `${v.machines.length} machine${v.machines.length === 1 ? "" : "s"}`,
    };
  });
}

export function createOverviewRoutes(_pool: Pool): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;

      await recordAdminAction(client, {
        adminUserId: r.platformAdmin.userId,
        action: "view_infra_overview",
        reason: "",
        context: extractAuditContext(req),
      });

      const [pg, redis, queues, fly, audit] = await Promise.all([
        postgresPill(),
        redisPill(),
        queuesPill(),
        flyPill(),
        client.query<AuditRow>(
          `SELECT id, admin_user_id, action, reason, occurred_at, payload
             FROM platform_admin_audit_log
            WHERE action = ANY($1::text[])
            ORDER BY occurred_at DESC
            LIMIT 20`,
          [INFRA_AUDIT_ACTIONS],
        ),
      ]);

      const pills: StatusPill[] = [pg, redis, queues, ...fly];

      res.json({
        pills,
        recent_audit: audit.rows,
      });
    }),
  );

  return router;
}
