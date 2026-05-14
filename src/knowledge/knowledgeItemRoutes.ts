/**
 * Knowledge items routes (HEL-87).
 *
 * Layer 2 of the three-layer memory model. Durable RAG-retrievable facts:
 * uploaded docs, connector pulls, synthesized patterns from reflection,
 * human-verified items.
 *
 * Mounted at `/api/knowledge-items` to avoid collision with the legacy
 * `/api/knowledge` (FastAPI-flavored knowledge bases — retired in HEL-97).
 *
 * Search (hybrid semantic + lexical with org-chart-aware ranking) lands in
 * HEL-89 on top of this CRUD foundation.
 */

import { Router } from "express";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_KINDS = new Set(["document", "connector_pull", "synthesized", "verified"]);
const MAX_TITLE = 200;
const MAX_CONTENT = 32_000;

interface KnowledgeItemRow {
  id: string;
  workspace_id: string | null;
  scope: "autoflow_curated" | "workspace";
  kind: "document" | "connector_pull" | "synthesized" | "verified";
  title: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  source_type: string;
  source_ref: string | null;
  source_episode_ids: string[];
  mission_id: string | null;
  author_user_id: string | null;
  author_agent_id: string | null;
  trust_score: string; // numeric, returns as string from pg
  superseded_by: string | null;
  valid_until: string | null;
  embedding_version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface KnowledgeItemResponse {
  id: string;
  workspaceId: string | null;
  scope: KnowledgeItemRow["scope"];
  kind: KnowledgeItemRow["kind"];
  title: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  sourceType: string;
  sourceRef: string | null;
  sourceEpisodeIds: string[];
  missionId: string | null;
  authorUserId: string | null;
  authorAgentId: string | null;
  trustScore: number;
  supersededBy: string | null;
  validUntil: string | null;
  embeddingVersion: number;
  createdAt: string;
  updatedAt: string;
}

function rowToResponse(row: KnowledgeItemRow): KnowledgeItemResponse {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    scope: row.scope,
    kind: row.kind,
    title: row.title,
    content: row.content,
    tags: row.tags,
    metadata: row.metadata,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    sourceEpisodeIds: row.source_episode_ids,
    missionId: row.mission_id,
    authorUserId: row.author_user_id,
    authorAgentId: row.author_agent_id,
    trustScore: Number(row.trust_score),
    supersededBy: row.superseded_by,
    validUntil: row.valid_until,
    embeddingVersion: row.embedding_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createKnowledgeItemRoutes(pool: Pool): Router {
  const router = Router();

  // GET /api/knowledge-items?kind=&mission_id=&trust_min=&include_superseded=true
  router.get("/", async (req: WorkspaceAwareRequest, res) => {
    const workspaceId = req.workspace?.id;
    const userId = req.auth?.sub;
    if (!workspaceId || !userId) return res.status(401).json({ error: "Authentication required" });

    const kind = typeof req.query.kind === "string" ? req.query.kind : null;
    if (kind && !VALID_KINDS.has(kind)) return res.status(400).json({ error: "invalid kind" });
    const missionId = typeof req.query.mission_id === "string" ? req.query.mission_id : null;
    const trustMin = typeof req.query.trust_min === "string" ? Number(req.query.trust_min) : null;
    const includeSuperseded = req.query.include_superseded === "true";
    const limit = Math.min(Number(req.query.limit ?? 50), 200);

    try {
      const rows = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
        const result = await client.query<KnowledgeItemRow>(
          `SELECT * FROM knowledge_items
            WHERE deleted_at IS NULL
              AND ($1::boolean OR superseded_by IS NULL)
              AND ($2::text IS NULL OR kind = $2)
              AND ($3::uuid IS NULL OR mission_id = $3)
              AND ($4::numeric IS NULL OR trust_score >= $4)
            ORDER BY updated_at DESC
            LIMIT $5`,
          [includeSuperseded, kind, missionId, trustMin, limit],
        );
        return result.rows;
      });
      return res.json({ items: rows.map(rowToResponse), total: rows.length });
    } catch (err) {
      console.error("[knowledge-items] list failed:", (err as Error).message);
      return res.status(500).json({ error: "Failed to list knowledge items" });
    }
  });

  // GET /api/knowledge-items/:id
  router.get("/:id", async (req: WorkspaceAwareRequest, res) => {
    const workspaceId = req.workspace?.id;
    const userId = req.auth?.sub;
    const id = req.params.id;
    if (!workspaceId || !userId) return res.status(401).json({ error: "Authentication required" });
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid id" });

    try {
      const row = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
        const result = await client.query<KnowledgeItemRow>(
          "SELECT * FROM knowledge_items WHERE id = $1 AND deleted_at IS NULL",
          [id],
        );
        return result.rows[0] ?? null;
      });
      if (!row) return res.status(404).json({ error: "Not found" });
      return res.json(rowToResponse(row));
    } catch (err) {
      console.error("[knowledge-items] get failed:", (err as Error).message);
      return res.status(500).json({ error: "Failed to fetch knowledge item" });
    }
  });

  // POST /api/knowledge-items
  // body: { title, content, kind, source_type, source_ref?, mission_id?, tags?, metadata? }
  router.post("/", async (req: WorkspaceAwareRequest, res) => {
    const workspaceId = req.workspace?.id;
    const userId = req.auth?.sub;
    if (!workspaceId || !userId) return res.status(401).json({ error: "Authentication required" });

    const {
      title,
      content,
      kind = "document",
      source_type = "inline",
      source_ref,
      mission_id,
      tags,
      metadata,
    } = req.body ?? {};

    if (typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "title required" });
    }
    if (typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "content required" });
    }
    if (title.length > MAX_TITLE) return res.status(400).json({ error: `title ≤ ${MAX_TITLE}` });
    if (content.length > MAX_CONTENT) return res.status(400).json({ error: `content ≤ ${MAX_CONTENT}` });
    if (!VALID_KINDS.has(kind)) return res.status(400).json({ error: "invalid kind" });
    if (mission_id != null && (typeof mission_id !== "string" || !UUID_RE.test(mission_id))) {
      return res.status(400).json({ error: "invalid mission_id" });
    }
    const tagsArr: string[] = Array.isArray(tags) ? tags.filter((t) => typeof t === "string") : [];
    const metaObj: Record<string, unknown> =
      metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};

    const id = randomUUID();
    try {
      const row = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
        const result = await client.query<KnowledgeItemRow>(
          `INSERT INTO knowledge_items
            (id, workspace_id, scope, kind, title, content, tags, metadata,
             source_type, source_ref, mission_id, author_user_id)
           VALUES ($1, $2, 'workspace', $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [
            id,
            workspaceId,
            kind,
            title.trim(),
            content,
            tagsArr,
            JSON.stringify(metaObj),
            source_type,
            source_ref ?? null,
            mission_id ?? null,
            userId,
          ],
        );
        return result.rows[0];
      });
      return res.status(201).json(rowToResponse(row));
    } catch (err) {
      console.error("[knowledge-items] create failed:", (err as Error).message);
      return res.status(500).json({ error: "Failed to create knowledge item" });
    }
  });

  // POST /api/knowledge-items/:id/supersede
  // body: { superseded_by: <new item id> }
  router.post("/:id/supersede", async (req: WorkspaceAwareRequest, res) => {
    const workspaceId = req.workspace?.id;
    const userId = req.auth?.sub;
    const id = req.params.id;
    const { superseded_by } = req.body ?? {};
    if (!workspaceId || !userId) return res.status(401).json({ error: "Authentication required" });
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid id" });
    if (typeof superseded_by !== "string" || !UUID_RE.test(superseded_by)) {
      return res.status(400).json({ error: "superseded_by must be a uuid" });
    }

    try {
      const row = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
        const result = await client.query<KnowledgeItemRow>(
          `UPDATE knowledge_items
             SET superseded_by = $2, updated_at = now()
           WHERE id = $1 AND deleted_at IS NULL
           RETURNING *`,
          [id, superseded_by],
        );
        return result.rows[0] ?? null;
      });
      if (!row) return res.status(404).json({ error: "Not found" });
      return res.json(rowToResponse(row));
    } catch (err) {
      console.error("[knowledge-items] supersede failed:", (err as Error).message);
      return res.status(500).json({ error: "Failed to supersede" });
    }
  });

  // DELETE /api/knowledge-items/:id (soft-delete)
  router.delete("/:id", async (req: WorkspaceAwareRequest, res) => {
    const workspaceId = req.workspace?.id;
    const userId = req.auth?.sub;
    const id = req.params.id;
    if (!workspaceId || !userId) return res.status(401).json({ error: "Authentication required" });
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid id" });

    try {
      const ok = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
        const result = await client.query(
          "UPDATE knowledge_items SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL",
          [id],
        );
        return (result.rowCount ?? 0) > 0;
      });
      if (!ok) return res.status(404).json({ error: "Not found" });
      return res.status(204).end();
    } catch (err) {
      console.error("[knowledge-items] delete failed:", (err as Error).message);
      return res.status(500).json({ error: "Failed to delete" });
    }
  });

  return router;
}
