/**
 * AutoFlow curated knowledge admin routes (HEL-93).
 *
 * The `autoflow_curated` scope of `knowledge_items` is the AutoFlow-managed
 * global tier — common SOPs and best practices visible to every workspace's
 * agents (unless that workspace opts out). These routes let staff users
 * CRUD curated items.
 *
 * Mounted at `/api/admin/curated-knowledge`. Gated by `requireStaff` (env-var
 * allowlist for v1; see src/admin/staffAuth.ts).
 *
 * Curated items have:
 *   - `scope = 'autoflow_curated'`
 *   - `workspace_id IS NULL` (enforced by the CHECK constraint in HEL-86)
 *
 * Unlike workspace-scoped knowledge items, RLS reads pass for everyone since
 * the policy includes `scope = 'autoflow_curated'`. Writes still go through
 * the workspace-write policy — staff endpoints bypass via direct pool query
 * (no `withWorkspaceContext`) so the workspace_id check doesn't block.
 */

import { Router } from "express";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { requireStaff } from "./staffAuth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_KINDS = new Set(["document", "synthesized", "verified"]); // no connector_pull for curated
const MAX_TITLE = 200;
const MAX_CONTENT = 32_000;

interface CuratedRow {
  id: string;
  scope: "autoflow_curated";
  kind: "document" | "synthesized" | "verified";
  title: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  source_type: string;
  source_ref: string | null;
  trust_score: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function rowToResponse(row: CuratedRow) {
  return {
    id: row.id,
    scope: row.scope,
    kind: row.kind,
    title: row.title,
    content: row.content,
    tags: row.tags,
    metadata: row.metadata,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    trustScore: Number(row.trust_score),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createCuratedKnowledgeRoutes(pool: Pool): Router {
  const router = Router();

  // Staff gate first
  router.use(requireStaff);

  // GET /api/admin/curated-knowledge
  router.get("/", async (req, res) => {
    try {
      const result = await pool.query<CuratedRow>(
        `SELECT id, scope, kind, title, content, tags, metadata, source_type, source_ref,
                trust_score, created_at, updated_at, deleted_at
           FROM knowledge_items
          WHERE scope = 'autoflow_curated' AND deleted_at IS NULL
          ORDER BY updated_at DESC
          LIMIT 500`,
      );
      return res.json({ items: result.rows.map(rowToResponse), total: result.rowCount });
    } catch (err) {
      console.error("[admin/curated-knowledge] list failed:", (err as Error).message);
      return res.status(500).json({ error: "Failed to list curated items" });
    }
  });

  // GET /api/admin/curated-knowledge/:id
  router.get("/:id", async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid id" });

    try {
      const result = await pool.query<CuratedRow>(
        "SELECT * FROM knowledge_items WHERE id = $1 AND scope = 'autoflow_curated' AND deleted_at IS NULL",
        [id],
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
      return res.json(rowToResponse(result.rows[0]));
    } catch (err) {
      console.error("[admin/curated-knowledge] get failed:", (err as Error).message);
      return res.status(500).json({ error: "Failed to fetch curated item" });
    }
  });

  // POST /api/admin/curated-knowledge
  router.post("/", async (req, res) => {
    const { title, content, kind = "document", source_type = "curated", source_ref, tags, metadata, trust_score } =
      req.body ?? {};

    if (typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "title required" });
    }
    if (typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "content required" });
    }
    if (title.length > MAX_TITLE) return res.status(400).json({ error: `title ≤ ${MAX_TITLE}` });
    if (content.length > MAX_CONTENT) return res.status(400).json({ error: `content ≤ ${MAX_CONTENT}` });
    if (!VALID_KINDS.has(kind)) return res.status(400).json({ error: "invalid kind" });

    const tagsArr: string[] = Array.isArray(tags) ? tags.filter((t: unknown) => typeof t === "string") : [];
    const metaObj: Record<string, unknown> =
      metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
    const trust = typeof trust_score === "number" ? trust_score : 0.95; // curated defaults to high trust

    const id = randomUUID();
    try {
      const result = await pool.query<CuratedRow>(
        `INSERT INTO knowledge_items
            (id, workspace_id, scope, kind, title, content, tags, metadata,
             source_type, source_ref, trust_score)
          VALUES ($1, NULL, 'autoflow_curated', $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *`,
        [id, kind, title.trim(), content, tagsArr, JSON.stringify(metaObj), source_type, source_ref ?? null, trust],
      );
      return res.status(201).json(rowToResponse(result.rows[0]));
    } catch (err) {
      console.error("[admin/curated-knowledge] create failed:", (err as Error).message);
      return res.status(500).json({ error: "Failed to create curated item" });
    }
  });

  // PATCH /api/admin/curated-knowledge/:id
  router.patch("/:id", async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid id" });

    const { title, content, kind, tags, metadata, trust_score } = req.body ?? {};
    if (title != null && (typeof title !== "string" || title.length > MAX_TITLE)) {
      return res.status(400).json({ error: `title must be string ≤ ${MAX_TITLE}` });
    }
    if (content != null && (typeof content !== "string" || content.length > MAX_CONTENT)) {
      return res.status(400).json({ error: `content must be string ≤ ${MAX_CONTENT}` });
    }
    if (kind != null && !VALID_KINDS.has(kind)) {
      return res.status(400).json({ error: "invalid kind" });
    }

    try {
      const result = await pool.query<CuratedRow>(
        `UPDATE knowledge_items
           SET title = COALESCE($2, title),
               content = COALESCE($3, content),
               kind = COALESCE($4, kind),
               tags = COALESCE($5::text[], tags),
               metadata = COALESCE($6::jsonb, metadata),
               trust_score = COALESCE($7::numeric, trust_score),
               updated_at = now()
         WHERE id = $1 AND scope = 'autoflow_curated' AND deleted_at IS NULL
         RETURNING *`,
        [
          id,
          title ?? null,
          content ?? null,
          kind ?? null,
          Array.isArray(tags) ? tags.filter((t: unknown) => typeof t === "string") : null,
          metadata && typeof metadata === "object" ? JSON.stringify(metadata) : null,
          typeof trust_score === "number" ? trust_score : null,
        ],
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
      return res.json(rowToResponse(result.rows[0]));
    } catch (err) {
      console.error("[admin/curated-knowledge] update failed:", (err as Error).message);
      return res.status(500).json({ error: "Failed to update curated item" });
    }
  });

  // DELETE /api/admin/curated-knowledge/:id (soft-delete)
  router.delete("/:id", async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid id" });

    try {
      const result = await pool.query(
        "UPDATE knowledge_items SET deleted_at = now() WHERE id = $1 AND scope = 'autoflow_curated' AND deleted_at IS NULL",
        [id],
      );
      if ((result.rowCount ?? 0) === 0) return res.status(404).json({ error: "Not found" });
      return res.status(204).end();
    } catch (err) {
      console.error("[admin/curated-knowledge] delete failed:", (err as Error).message);
      return res.status(500).json({ error: "Failed to delete curated item" });
    }
  });

  return router;
}
