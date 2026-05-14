/**
 * Workspace instructions routes (HEL-87).
 *
 * Layer 1 of the three-layer memory model. Human-authored CLAUDE.md-style
 * instructions that get inlined into every agent's system prompt at boot.
 * Versioned — every PATCH creates a new version row rather than overwriting.
 *
 * Mounted at `/api/instructions` from src/app.ts behind requireAuth +
 * workspaceResolver + requireRole. RLS at the Postgres layer enforces
 * workspace boundaries (see migrations/034_three_layer_memory.sql).
 */

import { Router } from "express";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TITLE = 200;
const MAX_BODY = 32_000; // ~8K tokens at 4 chars/token average

interface InstructionRow {
  id: string;
  workspace_id: string;
  mission_id: string | null;
  kind: "instruction" | "triage_policy";
  title: string;
  body: string;
  version: number;
  author_user_id: string | null;
  agent_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface InstructionResponse {
  id: string;
  workspaceId: string;
  missionId: string | null;
  kind: "instruction" | "triage_policy";
  title: string;
  body: string;
  version: number;
  authorUserId: string | null;
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToResponse(row: InstructionRow): InstructionResponse {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    missionId: row.mission_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    version: row.version,
    authorUserId: row.author_user_id,
    agentId: row.agent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createInstructionRoutes(pool: Pool): Router {
  const router = Router();

  // GET /api/instructions
  // Optional query: ?kind=instruction|triage_policy, ?mission_id=<uuid>, ?agent_id=<uuid>
  router.get("/", async (req: WorkspaceAwareRequest, res) => {
    const workspaceId = req.workspace?.id;
    const userId = req.auth?.sub;
    if (!workspaceId || !userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const kind = typeof req.query.kind === "string" ? req.query.kind : null;
    if (kind && !["instruction", "triage_policy"].includes(kind)) {
      return res.status(400).json({ error: "invalid kind" });
    }
    const missionId = typeof req.query.mission_id === "string" ? req.query.mission_id : null;
    const agentId = typeof req.query.agent_id === "string" ? req.query.agent_id : null;

    try {
      const rows = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
        const result = await client.query<InstructionRow>(
          `SELECT * FROM workspace_instructions
            WHERE deleted_at IS NULL
              AND ($1::text IS NULL OR kind = $1)
              AND ($2::uuid IS NULL OR mission_id = $2)
              AND ($3::uuid IS NULL OR agent_id = $3)
            ORDER BY updated_at DESC
            LIMIT 200`,
          [kind, missionId, agentId],
        );
        return result.rows;
      });
      return res.json({ instructions: rows.map(rowToResponse), total: rows.length });
    } catch (err) {
      console.error("[instructions] list failed:", (err as Error).message);
      return res.status(500).json({ error: "Failed to list instructions" });
    }
  });

  // GET /api/instructions/:id
  router.get("/:id", async (req: WorkspaceAwareRequest, res) => {
    const workspaceId = req.workspace?.id;
    const userId = req.auth?.sub;
    const id = req.params.id;
    if (!workspaceId || !userId) return res.status(401).json({ error: "Authentication required" });
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid id" });

    try {
      const row = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
        const result = await client.query<InstructionRow>(
          "SELECT * FROM workspace_instructions WHERE id = $1 AND deleted_at IS NULL",
          [id],
        );
        return result.rows[0] ?? null;
      });
      if (!row) return res.status(404).json({ error: "Not found" });
      return res.json(rowToResponse(row));
    } catch (err) {
      console.error("[instructions] get failed:", (err as Error).message);
      return res.status(500).json({ error: "Failed to fetch instruction" });
    }
  });

  // POST /api/instructions
  // body: { title, body, kind?: "instruction" | "triage_policy", mission_id?, agent_id? }
  router.post("/", async (req: WorkspaceAwareRequest, res) => {
    const workspaceId = req.workspace?.id;
    const userId = req.auth?.sub;
    if (!workspaceId || !userId) return res.status(401).json({ error: "Authentication required" });

    const { title, body, kind, mission_id, agent_id } = req.body ?? {};
    if (typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "title is required" });
    }
    if (typeof body !== "string" || !body.trim()) {
      return res.status(400).json({ error: "body is required" });
    }
    if (title.length > MAX_TITLE) {
      return res.status(400).json({ error: `title must be ≤ ${MAX_TITLE} chars` });
    }
    if (body.length > MAX_BODY) {
      return res.status(400).json({ error: `body must be ≤ ${MAX_BODY} chars` });
    }
    const k = kind ?? "instruction";
    if (!["instruction", "triage_policy"].includes(k)) {
      return res.status(400).json({ error: "invalid kind" });
    }
    if (mission_id != null && (typeof mission_id !== "string" || !UUID_RE.test(mission_id))) {
      return res.status(400).json({ error: "invalid mission_id" });
    }
    if (agent_id != null && (typeof agent_id !== "string" || !UUID_RE.test(agent_id))) {
      return res.status(400).json({ error: "invalid agent_id" });
    }
    if (k === "triage_policy" && !agent_id) {
      return res.status(400).json({ error: "triage_policy instructions require agent_id" });
    }

    const id = randomUUID();
    try {
      const row = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
        const result = await client.query<InstructionRow>(
          `INSERT INTO workspace_instructions
              (id, workspace_id, mission_id, kind, title, body, version, author_user_id, agent_id)
            VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8)
            RETURNING *`,
          [id, workspaceId, mission_id ?? null, k, title.trim(), body, userId, agent_id ?? null],
        );
        return result.rows[0];
      });
      return res.status(201).json(rowToResponse(row));
    } catch (err) {
      console.error("[instructions] create failed:", (err as Error).message);
      return res.status(500).json({ error: "Failed to create instruction" });
    }
  });

  // PATCH /api/instructions/:id
  // Creates a NEW version row keyed to the same logical id but version+1, leaving
  // the prior version retrievable via the versions endpoint.
  router.patch("/:id", async (req: WorkspaceAwareRequest, res) => {
    const workspaceId = req.workspace?.id;
    const userId = req.auth?.sub;
    const id = req.params.id;
    if (!workspaceId || !userId) return res.status(401).json({ error: "Authentication required" });
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid id" });

    const { title, body } = req.body ?? {};
    if (title != null && (typeof title !== "string" || title.length > MAX_TITLE)) {
      return res.status(400).json({ error: `title must be string ≤ ${MAX_TITLE} chars` });
    }
    if (body != null && (typeof body !== "string" || body.length > MAX_BODY)) {
      return res.status(400).json({ error: `body must be string ≤ ${MAX_BODY} chars` });
    }
    if (title == null && body == null) {
      return res.status(400).json({ error: "title or body required" });
    }

    try {
      const row = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
        const existing = await client.query<InstructionRow>(
          "SELECT * FROM workspace_instructions WHERE id = $1 AND deleted_at IS NULL",
          [id],
        );
        if (existing.rows.length === 0) return null;
        const cur = existing.rows[0];
        const result = await client.query<InstructionRow>(
          `UPDATE workspace_instructions
            SET title = COALESCE($2, title),
                body = COALESCE($3, body),
                version = version + 1,
                author_user_id = $4,
                updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL
            RETURNING *`,
          [id, title ?? cur.title, body ?? cur.body, userId],
        );
        return result.rows[0];
      });
      if (!row) return res.status(404).json({ error: "Not found" });
      return res.json(rowToResponse(row));
    } catch (err) {
      console.error("[instructions] update failed:", (err as Error).message);
      return res.status(500).json({ error: "Failed to update instruction" });
    }
  });

  // DELETE /api/instructions/:id — soft-delete
  router.delete("/:id", async (req: WorkspaceAwareRequest, res) => {
    const workspaceId = req.workspace?.id;
    const userId = req.auth?.sub;
    const id = req.params.id;
    if (!workspaceId || !userId) return res.status(401).json({ error: "Authentication required" });
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid id" });

    try {
      const ok = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
        const result = await client.query(
          "UPDATE workspace_instructions SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL",
          [id],
        );
        return (result.rowCount ?? 0) > 0;
      });
      if (!ok) return res.status(404).json({ error: "Not found" });
      return res.status(204).end();
    } catch (err) {
      console.error("[instructions] delete failed:", (err as Error).message);
      return res.status(500).json({ error: "Failed to delete instruction" });
    }
  });

  return router;
}
