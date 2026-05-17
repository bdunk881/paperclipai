/**
 * Routines CRUD routes (HEL-108).
 *
 *   GET    /api/routines          — list workspace routines
 *   PATCH  /api/routines/:id      — toggle enabled / update schedule_cron
 *
 * enable/disable side-effects: adds or removes the BullMQ job scheduler so
 * cron fires stay in sync at mutation time without waiting for a worker restart.
 */

import { Router } from "express";
import type { Pool } from "pg";
import type { Queue } from "bullmq";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import type { RunJobPayload } from "../queue/queues";
import { addRepeatableJob, removeRepeatableJob } from "../queue/scheduler";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RoutineRow {
  id: string;
  workspace_id: string;
  agent_id: string | null;
  name: string;
  schedule_cron: string | null;
  trigger_kind: string;
  workflow_id: string;
  enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapRow(row: RoutineRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    name: row.name,
    scheduleCron: row.schedule_cron,
    triggerKind: row.trigger_kind,
    workflowId: row.workflow_id,
    enabled: row.enabled,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
  };
}

export function createRoutineRoutes(
  pool: Pool,
  runQueue: Queue<RunJobPayload> | null
) {
  const router = Router();

  // -------------------------------------------------------------------------
  // GET /api/routines — list routines in the active workspace
  // -------------------------------------------------------------------------
  router.get("/", async (req: AuthenticatedRequest, res) => {
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!workspaceId) {
      res.status(401).json({ error: "Workspace required" });
      return;
    }

    try {
      const result = await pool.query<RoutineRow>(
        `SELECT id, workspace_id::text, agent_id::text, name, schedule_cron,
                trigger_kind, workflow_id::text, enabled, created_at, updated_at
           FROM routines
          WHERE workspace_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT 100`,
        [workspaceId]
      );
      res.json({ routines: result.rows.map(mapRow) });
    } catch (err) {
      console.error("[routines] list failed:", (err as Error).message);
      res.status(500).json({ error: "Failed to list routines" });
    }
  });

  // -------------------------------------------------------------------------
  // PATCH /api/routines/:id — update enabled flag and/or schedule_cron.
  //
  // Accepted body fields: { enabled?: boolean, scheduleCron?: string | null }
  // At least one must be present. Other fields are ignored.
  //
  // Side-effect: when `enabled` changes or `scheduleCron` is updated, the
  // BullMQ job scheduler is added or removed accordingly.
  // -------------------------------------------------------------------------
  router.patch("/:id", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const routineId = req.params.id;
    if (!routineId || !UUID_RE.test(routineId)) {
      res.status(400).json({ error: "Invalid routine ID format" });
      return;
    }

    const body = req.body as { enabled?: unknown; scheduleCron?: unknown };
    const hasEnabled = "enabled" in body;
    const hasScheduleCron = "scheduleCron" in body;

    if (!hasEnabled && !hasScheduleCron) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }

    const enabledValue =
      hasEnabled && typeof body.enabled === "boolean" ? body.enabled : undefined;
    const scheduleCronValue =
      hasScheduleCron
        ? typeof body.scheduleCron === "string" && body.scheduleCron.trim()
          ? body.scheduleCron.trim()
          : null
        : undefined;

    try {
      // Build a partial UPDATE, touching only the provided fields.
      const setClauses: string[] = ["updated_at = now()"];
      const values: unknown[] = [routineId, workspaceId];

      if (enabledValue !== undefined) {
        values.push(enabledValue);
        setClauses.push(`enabled = $${values.length}`);
      }
      if (scheduleCronValue !== undefined) {
        values.push(scheduleCronValue);
        setClauses.push(`schedule_cron = $${values.length}`);
      }

      const result = await pool.query<RoutineRow>(
        `UPDATE routines
            SET ${setClauses.join(", ")}
          WHERE id = $1::uuid
            AND workspace_id = $2::uuid
          RETURNING id, workspace_id::text, agent_id::text, name, schedule_cron,
                    trigger_kind, workflow_id::text, enabled, created_at, updated_at`,
        values
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "Routine not found" });
        return;
      }

      const updated = result.rows[0]!;

      // Sync the BullMQ scheduler when enabled state or cron changes.
      if (runQueue) {
        if (!updated.enabled) {
          await removeRepeatableJob(runQueue, updated.id);
        } else if (updated.schedule_cron) {
          await addRepeatableJob(
            runQueue,
            updated.id,
            updated.schedule_cron,
            updated.workspace_id
          );
        } else {
          // enabled=true but no cron — ensure any stale scheduler is removed.
          await removeRepeatableJob(runQueue, updated.id);
        }
      }

      res.json(mapRow(updated));
    } catch (err) {
      console.error("[routines] patch failed:", (err as Error).message);
      res.status(500).json({ error: "Failed to update routine" });
    }
  });

  return router;
}
