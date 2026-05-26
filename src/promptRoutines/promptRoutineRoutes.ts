/**
 * Prompt routines — scheduled-prompt CRUD that sits alongside Studio
 * workflows on the Routines page.
 *
 *   GET    /api/prompt-routines        — list workspace routines
 *   POST   /api/prompt-routines        — create
 *   PATCH  /api/prompt-routines/:id    — update fields (status, prompt, schedule…)
 *   DELETE /api/prompt-routines/:id    — delete
 *
 * RLS-scoped to the caller's workspace via `withWorkspaceContext`.
 * Scheduler that fires the prompts ships separately; this surface is the
 * CRUD-only definition layer.
 */

import { Router } from "express";
import type { Pool } from "pg";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import { asyncHandler } from "../middleware/asyncHandler";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUS = ["active", "paused", "ended"] as const;
type PromptRoutineStatus = (typeof VALID_STATUS)[number];

interface PromptRoutineRow {
  id: string;
  workspace_id: string;
  name: string;
  prompt: string;
  mission_id: string | null;
  agent_id: string | null;
  days_of_week: number[];
  time_of_day: string;
  timezone: string;
  starts_at: string;
  ends_at: string | null;
  status: PromptRoutineStatus;
  last_fired_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromptRoutineResponse {
  id: string;
  name: string;
  prompt: string;
  missionId: string | null;
  agentId: string | null;
  daysOfWeek: number[];
  timeOfDay: string;
  timezone: string;
  startsAt: string;
  endsAt: string | null;
  status: PromptRoutineStatus;
  lastFiredAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToResponse(row: PromptRoutineRow): PromptRoutineResponse {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    missionId: row.mission_id,
    agentId: row.agent_id,
    daysOfWeek: row.days_of_week,
    timeOfDay: row.time_of_day,
    timezone: row.timezone,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    lastFiredAt: row.last_fired_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateDaysOfWeek(input: unknown): { ok: true; value: number[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length === 0 || input.length > 7) {
    return { ok: false, error: "daysOfWeek must be a non-empty array of 1-7 entries" };
  }
  const out: number[] = [];
  for (const raw of input) {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 6) {
      return { ok: false, error: "daysOfWeek entries must be integers 0..6 (Sun=0..Sat=6)" };
    }
    if (!out.includes(n)) out.push(n);
  }
  out.sort((a, b) => a - b);
  return { ok: true, value: out };
}

function validateTimeOfDay(input: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof input !== "string" || !/^\d{2}:\d{2}(:\d{2})?$/.test(input)) {
    return { ok: false, error: "timeOfDay must be HH:MM (24-hour)" };
  }
  return { ok: true, value: input.length === 5 ? `${input}:00` : input };
}

function validateUuidOrNull(input: unknown, field: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (input == null || input === "") return { ok: true, value: null };
  if (typeof input !== "string" || !UUID_RE.test(input)) {
    return { ok: false, error: `${field} must be a UUID or null` };
  }
  return { ok: true, value: input };
}

function validateOptionalIso(input: unknown, field: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (input == null || input === "") return { ok: true, value: null };
  if (typeof input !== "string") return { ok: false, error: `${field} must be an ISO timestamp` };
  const parsed = Date.parse(input);
  if (Number.isNaN(parsed)) return { ok: false, error: `${field} must be a valid ISO timestamp` };
  return { ok: true, value: new Date(parsed).toISOString() };
}

export function createPromptRoutineRoutes(pool: Pool): Router {
  const router = Router();

  // -- List --------------------------------------------------------------
  router.get(
    "/",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = req.auth?.sub;
      const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
      if (!userId || !workspaceId) {
        res.status(401).json({ error: "Authenticated user + workspace required" });
        return;
      }

      try {
        const rows = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
          const result = await client.query<PromptRoutineRow>(
            `SELECT * FROM prompt_routines ORDER BY created_at DESC`,
          );
          return result.rows;
        });
        res.json({ routines: rows.map(rowToResponse), total: rows.length });
      } catch (err) {
        console.error("[prompt-routines] list failed:", (err as Error).message);
        res.status(500).json({ error: "Failed to list prompt routines" });
      }
    }),
  );

  // -- Create ------------------------------------------------------------
  router.post(
    "/",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = req.auth?.sub;
      const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
      if (!userId || !workspaceId) {
        res.status(401).json({ error: "Authenticated user + workspace required" });
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;

      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!prompt) {
        res.status(400).json({ error: "prompt is required" });
        return;
      }

      const missionCheck = validateUuidOrNull(body.missionId, "missionId");
      if (!missionCheck.ok) {
        res.status(400).json({ error: missionCheck.error });
        return;
      }
      const agentCheck = validateUuidOrNull(body.agentId, "agentId");
      if (!agentCheck.ok) {
        res.status(400).json({ error: agentCheck.error });
        return;
      }

      const daysCheck = validateDaysOfWeek(body.daysOfWeek ?? [1, 2, 3, 4, 5]);
      if (!daysCheck.ok) {
        res.status(400).json({ error: daysCheck.error });
        return;
      }
      const timeCheck = validateTimeOfDay(body.timeOfDay ?? "09:00");
      if (!timeCheck.ok) {
        res.status(400).json({ error: timeCheck.error });
        return;
      }

      const timezone = typeof body.timezone === "string" && body.timezone.trim()
        ? body.timezone.trim()
        : "UTC";

      const startsCheck = validateOptionalIso(body.startsAt, "startsAt");
      if (!startsCheck.ok) {
        res.status(400).json({ error: startsCheck.error });
        return;
      }
      const endsCheck = validateOptionalIso(body.endsAt, "endsAt");
      if (!endsCheck.ok) {
        res.status(400).json({ error: endsCheck.error });
        return;
      }
      const startsAt = startsCheck.value ?? new Date().toISOString();

      try {
        const row = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
          const result = await client.query<PromptRoutineRow>(
            `INSERT INTO prompt_routines (
               workspace_id, name, prompt, mission_id, agent_id,
               days_of_week, time_of_day, timezone, starts_at, ends_at,
               created_by
             ) VALUES ($1, $2, $3, $4, $5, $6::int[], $7::time, $8, $9, $10, $11)
             RETURNING *`,
            [
              workspaceId,
              name,
              prompt,
              missionCheck.value,
              agentCheck.value,
              daysCheck.value,
              timeCheck.value,
              timezone,
              startsAt,
              endsCheck.value,
              userId,
            ],
          );
          return result.rows[0];
        });
        res.status(201).json({ routine: rowToResponse(row) });
      } catch (err) {
        console.error("[prompt-routines] create failed:", (err as Error).message);
        res.status(500).json({ error: "Failed to create prompt routine" });
      }
    }),
  );

  // -- Patch -------------------------------------------------------------
  router.patch(
    "/:id",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = req.auth?.sub;
      const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
      if (!userId || !workspaceId) {
        res.status(401).json({ error: "Authenticated user + workspace required" });
        return;
      }

      const id = req.params.id;
      if (!UUID_RE.test(id)) {
        res.status(400).json({ error: "id must be a UUID" });
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const sets: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (body.name !== undefined) {
        if (typeof body.name !== "string" || !body.name.trim()) {
          res.status(400).json({ error: "name must be a non-empty string" });
          return;
        }
        sets.push(`name = $${idx++}`);
        values.push(body.name.trim());
      }
      if (body.prompt !== undefined) {
        if (typeof body.prompt !== "string" || !body.prompt.trim()) {
          res.status(400).json({ error: "prompt must be a non-empty string" });
          return;
        }
        sets.push(`prompt = $${idx++}`);
        values.push(body.prompt.trim());
      }
      if (body.missionId !== undefined) {
        const check = validateUuidOrNull(body.missionId, "missionId");
        if (!check.ok) {
          res.status(400).json({ error: check.error });
          return;
        }
        sets.push(`mission_id = $${idx++}`);
        values.push(check.value);
      }
      if (body.agentId !== undefined) {
        const check = validateUuidOrNull(body.agentId, "agentId");
        if (!check.ok) {
          res.status(400).json({ error: check.error });
          return;
        }
        sets.push(`agent_id = $${idx++}`);
        values.push(check.value);
      }
      if (body.daysOfWeek !== undefined) {
        const check = validateDaysOfWeek(body.daysOfWeek);
        if (!check.ok) {
          res.status(400).json({ error: check.error });
          return;
        }
        sets.push(`days_of_week = $${idx++}::int[]`);
        values.push(check.value);
      }
      if (body.timeOfDay !== undefined) {
        const check = validateTimeOfDay(body.timeOfDay);
        if (!check.ok) {
          res.status(400).json({ error: check.error });
          return;
        }
        sets.push(`time_of_day = $${idx++}::time`);
        values.push(check.value);
      }
      if (body.timezone !== undefined) {
        if (typeof body.timezone !== "string" || !body.timezone.trim()) {
          res.status(400).json({ error: "timezone must be a non-empty string" });
          return;
        }
        sets.push(`timezone = $${idx++}`);
        values.push(body.timezone.trim());
      }
      if (body.startsAt !== undefined) {
        const check = validateOptionalIso(body.startsAt, "startsAt");
        if (!check.ok || !check.value) {
          res.status(400).json({ error: check.ok ? "startsAt cannot be null" : check.error });
          return;
        }
        sets.push(`starts_at = $${idx++}`);
        values.push(check.value);
      }
      if (body.endsAt !== undefined) {
        const check = validateOptionalIso(body.endsAt, "endsAt");
        if (!check.ok) {
          res.status(400).json({ error: check.error });
          return;
        }
        sets.push(`ends_at = $${idx++}`);
        values.push(check.value);
      }
      if (body.status !== undefined) {
        if (typeof body.status !== "string" || !VALID_STATUS.includes(body.status as PromptRoutineStatus)) {
          res.status(400).json({ error: `status must be one of: ${VALID_STATUS.join(", ")}` });
          return;
        }
        sets.push(`status = $${idx++}`);
        values.push(body.status);
      }

      if (sets.length === 0) {
        res.status(400).json({ error: "No editable fields provided" });
        return;
      }

      values.push(id);
      const query = `UPDATE prompt_routines SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`;

      try {
        const row = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
          const result = await client.query<PromptRoutineRow>(query, values);
          return result.rows[0] ?? null;
        });
        if (!row) {
          res.status(404).json({ error: "Prompt routine not found" });
          return;
        }
        res.json({ routine: rowToResponse(row) });
      } catch (err) {
        console.error("[prompt-routines] update failed:", (err as Error).message);
        res.status(500).json({ error: "Failed to update prompt routine" });
      }
    }),
  );

  // -- Delete ------------------------------------------------------------
  router.delete(
    "/:id",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = req.auth?.sub;
      const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
      if (!userId || !workspaceId) {
        res.status(401).json({ error: "Authenticated user + workspace required" });
        return;
      }

      const id = req.params.id;
      if (!UUID_RE.test(id)) {
        res.status(400).json({ error: "id must be a UUID" });
        return;
      }

      try {
        const deleted = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
          const result = await client.query<{ id: string }>(
            `DELETE FROM prompt_routines WHERE id = $1 RETURNING id`,
            [id],
          );
          return (result.rowCount ?? 0) > 0;
        });
        if (!deleted) {
          res.status(404).json({ error: "Prompt routine not found" });
          return;
        }
        res.status(204).end();
      } catch (err) {
        console.error("[prompt-routines] delete failed:", (err as Error).message);
        res.status(500).json({ error: "Failed to delete prompt routine" });
      }
    }),
  );

  return router;
}
