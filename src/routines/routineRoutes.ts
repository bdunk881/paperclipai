/**
 * Routines CRUD routes (HEL-108).
 *
 *   GET    /api/routines          — list workspace routines
 *   POST   /api/routines          — create routine (agent + workflow + schedule)
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
import { asyncHandler } from "../middleware/asyncHandler";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RoutineRow {
  id: string;
  workspace_id: string;
  agent_id: string | null;
  name: string;
  schedule_cron: string | null;
  trigger_kind: string;
  workflow_id: string | null;
  prompt: string | null;
  system_prompt: string | null;
  llm_tier: "lite" | "standard" | "power" | null;
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
    prompt: row.prompt,
    systemPrompt: row.system_prompt,
    llmTier: row.llm_tier,
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
  router.get("/", asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!workspaceId) {
      res.status(401).json({ error: "Workspace required" });
      return;
    }

    try {
      const result = await pool.query<RoutineRow>(
        `SELECT id, workspace_id::text, agent_id::text, name, schedule_cron,
                trigger_kind, workflow_id::text, prompt, system_prompt, llm_tier,
                enabled, created_at, updated_at
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
  }));

  // -------------------------------------------------------------------------
  // POST /api/routines — create a standing task for an agent + workflow.
  // -------------------------------------------------------------------------
  router.post("/", asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const body = req.body as {
      agentId?: unknown;
      workflowId?: unknown;
      prompt?: unknown;
      systemPrompt?: unknown;
      llmTier?: unknown;
      name?: unknown;
      scheduleCron?: unknown;
      triggerKind?: unknown;
      enabled?: unknown;
    };

    const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
    const workflowIdRaw = typeof body.workflowId === "string" ? body.workflowId.trim() : "";
    const promptRaw = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const systemPromptRaw =
      typeof body.systemPrompt === "string" && body.systemPrompt.trim()
        ? body.systemPrompt.trim()
        : null;
    const llmTierRaw =
      typeof body.llmTier === "string" && ["lite", "standard", "power"].includes(body.llmTier)
        ? (body.llmTier as "lite" | "standard" | "power")
        : null;
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (!agentId || !UUID_RE.test(agentId)) {
      res.status(400).json({ error: "Valid agentId is required" });
      return;
    }

    // HEL-174: a routine is either workflow-backed (DAG) OR
    // prompt-backed (NL). Exactly one must be supplied. Enforce here
    // so the DB-level CHECK constraint isn't the user-facing error.
    const hasWorkflow = workflowIdRaw.length > 0;
    const hasPrompt = promptRaw.length > 0;
    if (hasWorkflow === hasPrompt) {
      res.status(400).json({
        error:
          "Provide exactly one of `workflowId` (DAG-backed) or `prompt` (NL-backed) — not both.",
      });
      return;
    }
    if (hasWorkflow && !UUID_RE.test(workflowIdRaw)) {
      res.status(400).json({ error: "Valid workflowId is required" });
      return;
    }
    if (hasPrompt && promptRaw.length > 10_000) {
      res.status(400).json({ error: "prompt is too long (max 10000 characters)" });
      return;
    }

    if (!name || name.length > 200) {
      res.status(400).json({ error: "name is required (max 200 characters)" });
      return;
    }

    const triggerKindRaw =
      typeof body.triggerKind === "string" ? body.triggerKind.trim() : "manual";
    const allowedTriggers = new Set(["manual", "scheduled", "webhook", "event"]);
    if (!allowedTriggers.has(triggerKindRaw)) {
      res.status(400).json({ error: "Invalid triggerKind" });
      return;
    }

    const scheduleCron =
      typeof body.scheduleCron === "string" && body.scheduleCron.trim()
        ? body.scheduleCron.trim()
        : null;
    const enabled = typeof body.enabled === "boolean" ? body.enabled : true;

    if (triggerKindRaw === "scheduled" && !scheduleCron) {
      res.status(400).json({ error: "scheduleCron is required when triggerKind is scheduled" });
      return;
    }

    try {
      const agentCheck = await pool.query<{ id: string }>(
        `SELECT id::text FROM agents
          WHERE id = $1::uuid AND workspace_id = $2::uuid`,
        [agentId, workspaceId],
      );
      if (agentCheck.rowCount === 0) {
        res.status(404).json({ error: "Agent not found in this workspace" });
        return;
      }

      if (hasWorkflow) {
        const workflowCheck = await pool.query<{ id: string }>(
          `SELECT id::text FROM workflows
            WHERE id = $1::uuid AND workspace_id = $2::uuid`,
          [workflowIdRaw, workspaceId],
        );
        if (workflowCheck.rowCount === 0) {
          res.status(404).json({ error: "Workflow not found in this workspace" });
          return;
        }
      }

      const insert = await pool.query<RoutineRow>(
        `INSERT INTO routines
            (workspace_id, agent_id, name, schedule_cron, trigger_kind,
             workflow_id, prompt, system_prompt, llm_tier, enabled)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5,
                 $6::uuid, $7, $8, $9, $10)
         RETURNING id, workspace_id::text, agent_id::text, name, schedule_cron,
                   trigger_kind, workflow_id::text, prompt, system_prompt, llm_tier,
                   enabled, created_at, updated_at`,
        [
          workspaceId,
          agentId,
          name,
          scheduleCron,
          triggerKindRaw,
          hasWorkflow ? workflowIdRaw : null,
          hasPrompt ? promptRaw : null,
          systemPromptRaw,
          llmTierRaw,
          enabled,
        ],
      );

      const created = insert.rows[0]!;

      if (runQueue && created.enabled && created.schedule_cron) {
        await addRepeatableJob(
          runQueue,
          created.id,
          created.schedule_cron,
          created.workspace_id,
        );
      }

      res.status(201).json(mapRow(created));
    } catch (err) {
      console.error("[routines] create failed:", (err as Error).message);
      res.status(500).json({ error: "Failed to create routine" });
    }
  }));

  // -------------------------------------------------------------------------
  // PATCH /api/routines/:id — update enabled flag and/or schedule_cron.
  //
  // Accepted body fields: { enabled?: boolean, scheduleCron?: string | null }
  // At least one must be present. Other fields are ignored.
  //
  // Side-effect: when `enabled` changes or `scheduleCron` is updated, the
  // BullMQ job scheduler is added or removed accordingly.
  // -------------------------------------------------------------------------
  router.patch("/:id", asyncHandler<AuthenticatedRequest>(async (req, res) => {
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
                    trigger_kind, workflow_id::text, prompt, system_prompt, llm_tier,
                    enabled, created_at, updated_at`,
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
  }));

  return router;
}
