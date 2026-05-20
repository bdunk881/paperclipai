import { Router } from "express";
import type { Pool } from "pg";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";

type SearchEntityType = "mission" | "agent" | "routine" | "approval";

interface SearchRow {
  type: SearchEntityType;
  id: string;
  title: string | null;
  subtitle: string | null;
  status: string | null;
  route: string;
  matched_fields: string[] | null;
  updated_at: Date | string | null;
}

export interface GlobalSearchResult {
  type: SearchEntityType;
  id: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  route: string;
  matchedFields: string[];
  updatedAt: string | null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function readQueryParam(value: unknown): string {
  if (Array.isArray(value)) {
    return readQueryParam(value[0]);
  }
  return typeof value === "string" ? value.trim() : "";
}

function readLimit(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
  return Math.min(Math.max(parsed, 1), 25);
}

function serializeDate(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function mapSearchRow(row: SearchRow): GlobalSearchResult {
  return {
    type: row.type,
    id: row.id,
    title: row.title?.trim() || "Untitled",
    subtitle: row.subtitle?.trim() || null,
    status: row.status?.trim() || null,
    route: row.route,
    matchedFields: Array.isArray(row.matched_fields) ? row.matched_fields.filter(Boolean) : [],
    updatedAt: serializeDate(row.updated_at),
  };
}

export function createGlobalSearchRoutes(pool: Pool) {
  const router = Router();

  router.get("/", async (req: WorkspaceAwareRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = req.workspace?.id ?? req.workspaceId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    if (!workspaceId) {
      res.status(401).json({ error: "Workspace context required." });
      return;
    }

    const query = readQueryParam(req.query.q ?? req.query.query);
    const likeQuery = `%${escapeLike(query)}%`;
    const limit = readLimit(req.query.limit);

    try {
      const result = await withWorkspaceContext(pool, { userId, workspaceId }, (client) =>
        client.query<SearchRow>(
          `
        WITH candidates AS (
          SELECT
            'mission'::text AS type,
            m.id::text AS id,
            m.statement AS title,
            c.name AS subtitle,
            m.status::text AS status,
            '/mission-state?mission=' || m.id::text AS route,
            ARRAY_REMOVE(ARRAY[
              CASE WHEN $4 <> '' AND m.statement ILIKE $3 ESCAPE '\\' THEN 'statement'::text END,
              CASE WHEN $4 <> '' AND c.name ILIKE $3 ESCAPE '\\' THEN 'company'::text END
            ], NULL)::text[] AS matched_fields,
            m.created_at AS updated_at,
            CASE
              WHEN $4 = '' THEN 10
              WHEN lower(m.statement) = lower($4) THEN 0
              WHEN m.statement ILIKE $3 ESCAPE '\\' THEN 1
              ELSE 4
            END AS rank
          FROM missions m
          JOIN companies c ON c.id = m.company_id
          WHERE c.workspace_id = $1::uuid
            AND ($4 = '' OR m.statement ILIKE $3 ESCAPE '\\' OR c.name ILIKE $3 ESCAPE '\\')

          UNION ALL

          SELECT
            'agent'::text AS type,
            a.id::text AS id,
            a.name AS title,
            COALESCE(t.name, a.role_key) AS subtitle,
            a.status::text AS status,
            '/agents/' || a.id::text AS route,
            ARRAY_REMOVE(ARRAY[
              CASE WHEN $4 <> '' AND a.name ILIKE $3 ESCAPE '\\' THEN 'name'::text END,
              CASE WHEN $4 <> '' AND a.role_key ILIKE $3 ESCAPE '\\' THEN 'role'::text END,
              CASE WHEN $4 <> '' AND t.name ILIKE $3 ESCAPE '\\' THEN 'team'::text END
            ], NULL)::text[] AS matched_fields,
            a.updated_at AS updated_at,
            CASE
              WHEN $4 = '' THEN 10
              WHEN lower(a.name) = lower($4) THEN 0
              WHEN a.name ILIKE $3 ESCAPE '\\' THEN 1
              WHEN a.role_key ILIKE $3 ESCAPE '\\' THEN 2
              ELSE 4
            END AS rank
          FROM agents a
          LEFT JOIN agent_teams t ON t.id = a.team_id
          WHERE a.workspace_id = $1::uuid
            AND (
              $4 = ''
              OR a.name ILIKE $3 ESCAPE '\\'
              OR a.role_key ILIKE $3 ESCAPE '\\'
              OR t.name ILIKE $3 ESCAPE '\\'
            )

          UNION ALL

          SELECT
            'routine'::text AS type,
            r.id::text AS id,
            r.name AS title,
            COALESCE(a.name, r.trigger_kind) AS subtitle,
            CASE WHEN r.enabled THEN 'enabled'::text ELSE 'disabled'::text END AS status,
            CASE
              WHEN r.agent_id IS NOT NULL THEN '/agents/' || r.agent_id::text || '/standing-tasks'
              ELSE '/builder'
            END AS route,
            ARRAY_REMOVE(ARRAY[
              CASE WHEN $4 <> '' AND r.name ILIKE $3 ESCAPE '\\' THEN 'name'::text END,
              CASE WHEN $4 <> '' AND r.trigger_kind ILIKE $3 ESCAPE '\\' THEN 'trigger'::text END,
              CASE WHEN $4 <> '' AND a.name ILIKE $3 ESCAPE '\\' THEN 'agent'::text END
            ], NULL)::text[] AS matched_fields,
            r.updated_at AS updated_at,
            CASE
              WHEN $4 = '' THEN 10
              WHEN lower(r.name) = lower($4) THEN 0
              WHEN r.name ILIKE $3 ESCAPE '\\' THEN 1
              WHEN a.name ILIKE $3 ESCAPE '\\' THEN 2
              ELSE 4
            END AS rank
          FROM routines r
          LEFT JOIN agents a ON a.id = r.agent_id AND a.workspace_id = r.workspace_id
          WHERE r.workspace_id = $1::uuid
            AND (
              $4 = ''
              OR r.name ILIKE $3 ESCAPE '\\'
              OR r.trigger_kind ILIKE $3 ESCAPE '\\'
              OR a.name ILIKE $3 ESCAPE '\\'
            )

          UNION ALL

          SELECT
            'approval'::text AS type,
            ar.id::text AS id,
            COALESCE(NULLIF(ar.step_name, ''), ar.template_name, 'Approval') AS title,
            COALESCE(approval_agent.name, ar.message) AS subtitle,
            ar.status::text AS status,
            '/approvals?approval=' || ar.id::text AS route,
            ARRAY_REMOVE(ARRAY[
              CASE WHEN $4 <> '' AND ar.step_name ILIKE $3 ESCAPE '\\' THEN 'step'::text END,
              CASE WHEN $4 <> '' AND ar.template_name ILIKE $3 ESCAPE '\\' THEN 'template'::text END,
              CASE WHEN $4 <> '' AND ar.message ILIKE $3 ESCAPE '\\' THEN 'message'::text END,
              CASE WHEN $4 <> '' AND approval_agent.name ILIKE $3 ESCAPE '\\' THEN 'agent'::text END
            ], NULL)::text[] AS matched_fields,
            COALESCE(ar.resolved_at, ar.requested_at) AS updated_at,
            CASE
              WHEN $4 = '' THEN 10
              WHEN lower(ar.step_name) = lower($4) THEN 0
              WHEN ar.step_name ILIKE $3 ESCAPE '\\' THEN 1
              WHEN ar.template_name ILIKE $3 ESCAPE '\\' THEN 2
              ELSE 4
            END AS rank
          FROM approval_requests ar
          JOIN agents approval_agent
            ON approval_agent.id = ar.agent_id
           AND approval_agent.workspace_id = $1::uuid
          WHERE (ar.assignee = $2 OR ar.user_id = $2)
            AND (
              $4 = ''
              OR ar.step_name ILIKE $3 ESCAPE '\\'
              OR ar.template_name ILIKE $3 ESCAPE '\\'
              OR ar.message ILIKE $3 ESCAPE '\\'
              OR approval_agent.name ILIKE $3 ESCAPE '\\'
            )
        )
        SELECT type, id, title, subtitle, status, route, matched_fields, updated_at
        FROM candidates
        ORDER BY rank ASC, updated_at DESC NULLS LAST, title ASC
        LIMIT $5::int
        `,
          [workspaceId, userId, likeQuery, query, limit],
        ),
      );

      const results = result.rows.map(mapSearchRow);
      res.json({ query, results, total: results.length });
    } catch (err) {
      console.error(`[search] failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to search workspace entities." });
    }
  });

  return router;
}
