/**
 * Activity event routes (HEL-29).
 *
 * GET /api/activity-events?limit=50
 *   Returns the latest activity_events for the active workspace, ordered
 *   newest first. RLS scoped via `withWorkspaceContext`. The default + max
 *   limit is 50 so a runaway poll can't pull the whole table.
 *
 * Reads from the canonical `activity_events` table (HEL-13 schema, migration
 * 024 + 025). Writers populate it from anywhere a domain event happens:
 *   - HEL-25 confirm hiring plan: `hiring_plan_accepted`, `agent_provisioned`
 *   - HEL-29 routine runs (future): `run.started`, `run.completed`
 *   - HEL-71 approvals: `approval.requested`, `approval.resolved`
 *
 * SSE / WebSocket promotion is HEL-29 P3 scope — this v1 endpoint is the
 * polling-source that the dashboard's Activity page hits every 5s.
 */

import { Router } from "express";
import type { Pool } from "pg";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface ActivityEventRow {
  id: string;
  kind: string;
  actor: Record<string, unknown>;
  subject: Record<string, unknown>;
  payload: Record<string, unknown>;
  occurredAt: string;
}

interface DbRow {
  id: string;
  kind: string;
  actor: Record<string, unknown> | null;
  subject: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  occurred_at: Date | string;
}

function parseLimit(raw: unknown): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

export function createActivityRoutes(pool: Pool) {
  const router = Router();

  router.get("/", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const limit = parseLimit(req.query.limit);

    try {
      const result = await withWorkspaceContext(
        pool,
        { workspaceId, userId },
        async (client) =>
          client.query<DbRow>(
            `SELECT id, kind, actor, subject, payload, occurred_at
               FROM activity_events
              WHERE workspace_id = $1
              ORDER BY occurred_at DESC, id DESC
              LIMIT $2`,
            [workspaceId, limit],
          ),
      );

      const events: ActivityEventRow[] = result.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        actor: row.actor ?? {},
        subject: row.subject ?? {},
        payload: row.payload ?? {},
        occurredAt:
          row.occurred_at instanceof Date
            ? row.occurred_at.toISOString()
            : String(row.occurred_at),
      }));

      res.json({ events, limit, total: events.length });
    } catch (err) {
      console.error(`[activity] list failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to load activity feed" });
    }
  });

  return router;
}
