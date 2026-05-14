/**
 * Agent episode routes (HEL-87).
 *
 * Layer 3 of the three-layer memory model. Append-only event log of what
 * agents observed, did, and reflected on. Default 90-day TTL.
 *
 * Episodes are typically WRITTEN by agents via the save_memory tool (HEL-88)
 * — not via REST. These routes provide READ access for the dashboard +
 * deletion for cleanup. Search (semantic + lexical) lands in HEL-89.
 *
 * Mounted at `/api/episodes` from src/app.ts behind requireAuth +
 * workspaceResolver + requireRole.
 */

import { Router } from "express";
import type { Pool } from "pg";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_TYPES = new Set(["observation", "action_result", "reflection", "escalation"]);

interface EpisodeRow {
  id: string;
  workspace_id: string;
  agent_id: string;
  mission_id: string | null;
  run_id: string | null;
  episode_type: "observation" | "action_result" | "reflection" | "escalation";
  title: string;
  summary: string;
  evidence: Record<string, unknown>;
  embedding_version: number;
  ttl_days: number;
  expires_at: string;
  reflected_at: string | null;
  created_at: string;
}

interface EpisodeResponse {
  id: string;
  workspaceId: string;
  agentId: string;
  missionId: string | null;
  runId: string | null;
  episodeType: EpisodeRow["episode_type"];
  title: string;
  summary: string;
  evidence: Record<string, unknown>;
  embeddingVersion: number;
  ttlDays: number;
  expiresAt: string;
  reflectedAt: string | null;
  createdAt: string;
}

function rowToResponse(row: EpisodeRow): EpisodeResponse {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    missionId: row.mission_id,
    runId: row.run_id,
    episodeType: row.episode_type,
    title: row.title,
    summary: row.summary,
    evidence: row.evidence,
    embeddingVersion: row.embedding_version,
    ttlDays: row.ttl_days,
    expiresAt: row.expires_at,
    reflectedAt: row.reflected_at,
    createdAt: row.created_at,
  };
}

export function createEpisodeRoutes(pool: Pool): Router {
  const router = Router();

  // GET /api/episodes
  // Query: ?agent_id=&mission_id=&run_id=&episode_type=&since=<iso>&unreflected_only=true
  router.get("/", async (req: WorkspaceAwareRequest, res) => {
    const workspaceId = req.workspace?.id;
    const userId = req.auth?.sub;
    if (!workspaceId || !userId) return res.status(401).json({ error: "Authentication required" });

    const agentId = typeof req.query.agent_id === "string" ? req.query.agent_id : null;
    const missionId = typeof req.query.mission_id === "string" ? req.query.mission_id : null;
    const runId = typeof req.query.run_id === "string" ? req.query.run_id : null;
    const episodeType = typeof req.query.episode_type === "string" ? req.query.episode_type : null;
    const since = typeof req.query.since === "string" ? req.query.since : null;
    const unreflectedOnly = req.query.unreflected_only === "true";
    const limit = Math.min(Number(req.query.limit ?? 100), 500);

    if (episodeType && !VALID_TYPES.has(episodeType)) {
      return res.status(400).json({ error: "invalid episode_type" });
    }
    if (since && Number.isNaN(Date.parse(since))) {
      return res.status(400).json({ error: "invalid since (must be ISO timestamp)" });
    }

    try {
      const rows = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
        const result = await client.query<EpisodeRow>(
          `SELECT * FROM agent_episodes
            WHERE ($1::uuid IS NULL OR agent_id = $1)
              AND ($2::uuid IS NULL OR mission_id = $2)
              AND ($3::uuid IS NULL OR run_id = $3)
              AND ($4::text IS NULL OR episode_type = $4)
              AND ($5::timestamptz IS NULL OR created_at >= $5)
              AND ($6::boolean = false OR reflected_at IS NULL)
            ORDER BY created_at DESC
            LIMIT $7`,
          [agentId, missionId, runId, episodeType, since, unreflectedOnly, limit],
        );
        return result.rows;
      });
      return res.json({ episodes: rows.map(rowToResponse), total: rows.length });
    } catch (err) {
      console.error("[episodes] list failed:", (err as Error).message);
      return res.status(500).json({ error: "Failed to list episodes" });
    }
  });

  // GET /api/episodes/:id
  router.get("/:id", async (req: WorkspaceAwareRequest, res) => {
    const workspaceId = req.workspace?.id;
    const userId = req.auth?.sub;
    const id = req.params.id;
    if (!workspaceId || !userId) return res.status(401).json({ error: "Authentication required" });
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid id" });

    try {
      const row = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
        const result = await client.query<EpisodeRow>(
          "SELECT * FROM agent_episodes WHERE id = $1",
          [id],
        );
        return result.rows[0] ?? null;
      });
      if (!row) return res.status(404).json({ error: "Not found" });
      return res.json(rowToResponse(row));
    } catch (err) {
      console.error("[episodes] get failed:", (err as Error).message);
      return res.status(500).json({ error: "Failed to fetch episode" });
    }
  });

  // DELETE /api/episodes/:id — rare; TTL handles the common case.
  router.delete("/:id", async (req: WorkspaceAwareRequest, res) => {
    const workspaceId = req.workspace?.id;
    const userId = req.auth?.sub;
    const id = req.params.id;
    if (!workspaceId || !userId) return res.status(401).json({ error: "Authentication required" });
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid id" });

    try {
      const ok = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
        const result = await client.query("DELETE FROM agent_episodes WHERE id = $1", [id]);
        return (result.rowCount ?? 0) > 0;
      });
      if (!ok) return res.status(404).json({ error: "Not found" });
      return res.status(204).end();
    } catch (err) {
      console.error("[episodes] delete failed:", (err as Error).message);
      return res.status(500).json({ error: "Failed to delete episode" });
    }
  });

  return router;
}
