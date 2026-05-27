/**
 * Express routes for /api/connector-grants (HEL-205 PR B).
 *
 * Backs the per-connector "Manage" panel in the Connections hub: a workspace
 * admin grants/asks/denies a connector per scope (mission|team|agent). The
 * upsert is keyed on (workspace_id, connector_id, scope_kind, scope_id).
 *
 * Postgres is the only persistence path — in-memory mode returns 501 since
 * RLS-backed isolation is the whole point of this surface.
 */

import { Router, Response } from "express";
import type { Pool } from "pg";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import { asyncHandler } from "../middleware/asyncHandler";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";

type ConnectorGrantsRequest = AuthenticatedRequest & WorkspaceAwareRequest;

type ScopeKind = "mission" | "team" | "agent";
type Permission = "allow" | "ask" | "deny";

const SCOPE_KINDS: readonly ScopeKind[] = ["mission", "team", "agent"];
const PERMISSIONS: readonly Permission[] = ["allow", "ask", "deny"];

interface ConnectorGrantRow {
  id: string;
  workspace_id: string;
  connector_id: string;
  scope_kind: ScopeKind;
  scope_id: string;
  permission: Permission;
  created_at: string;
  created_by: string | null;
}

interface ConnectorGrant {
  id: string;
  workspaceId: string;
  connectorId: string;
  scopeKind: ScopeKind;
  scopeId: string;
  permission: Permission;
  createdAt: string;
  createdBy: string | null;
}

function serializeRow(row: ConnectorGrantRow): ConnectorGrant {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    connectorId: row.connector_id,
    scopeKind: row.scope_kind,
    scopeId: row.scope_id,
    permission: row.permission,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function getContext(
  req: ConnectorGrantsRequest,
  res: Response,
): { workspaceId: string; userId: string } | null {
  const userId = req.auth?.sub?.trim();
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required." });
    return null;
  }
  const workspaceId = req.workspaceId?.trim();
  if (!workspaceId) {
    res.status(400).json({ error: "Workspace context is required." });
    return null;
  }
  return { workspaceId, userId };
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isScopeKind(value: unknown): value is ScopeKind {
  return typeof value === "string" && (SCOPE_KINDS as readonly string[]).includes(value);
}

function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (PERMISSIONS as readonly string[]).includes(value);
}

export function createConnectorGrantsRoutes(pool: Pool): Router {
  const router = Router();

  // GET /api/connector-grants?connector_id=...
  router.get(
    "/",
    asyncHandler<ConnectorGrantsRequest>(async (req, res) => {
      const ctx = getContext(req, res);
      if (!ctx) return;

      const connectorId = normalizeString(req.query.connector_id);
      const params: unknown[] = [ctx.workspaceId];
      let sql =
        "select id, workspace_id, connector_id, scope_kind, scope_id, permission, created_at, created_by " +
        "from connector_grants where workspace_id = $1";
      if (connectorId) {
        params.push(connectorId);
        sql += ` and connector_id = $${params.length}`;
      }
      sql += " order by created_at desc";

      const { rows } = await pool.query<ConnectorGrantRow>(sql, params);
      res.json({ grants: rows.map(serializeRow), total: rows.length });
    }),
  );

  // PUT /api/connector-grants  body { connector_id, scope_kind, scope_id, permission }
  router.put(
    "/",
    asyncHandler<ConnectorGrantsRequest>(async (req, res) => {
      const ctx = getContext(req, res);
      if (!ctx) return;

      const body = (req.body ?? {}) as Record<string, unknown>;
      const connectorId = normalizeString(body.connector_id);
      const scopeKind = body.scope_kind;
      const scopeId = normalizeString(body.scope_id);
      const permission = body.permission;

      if (!connectorId) {
        res.status(400).json({ error: "connector_id is required." });
        return;
      }
      if (!isScopeKind(scopeKind)) {
        res
          .status(400)
          .json({ error: `scope_kind must be one of ${SCOPE_KINDS.join(", ")}.` });
        return;
      }
      if (!scopeId) {
        res.status(400).json({ error: "scope_id is required." });
        return;
      }
      if (!isPermission(permission)) {
        res
          .status(400)
          .json({ error: `permission must be one of ${PERMISSIONS.join(", ")}.` });
        return;
      }

      const { rows } = await pool.query<ConnectorGrantRow>(
        `insert into connector_grants
           (workspace_id, connector_id, scope_kind, scope_id, permission, created_by)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (workspace_id, connector_id, scope_kind, scope_id)
         do update set permission = excluded.permission
         returning id, workspace_id, connector_id, scope_kind, scope_id,
                   permission, created_at, created_by`,
        [ctx.workspaceId, connectorId, scopeKind, scopeId, permission, ctx.userId],
      );

      const row = rows[0];
      if (!row) {
        res.status(500).json({ error: "Failed to upsert connector grant." });
        return;
      }
      res.status(200).json({ grant: serializeRow(row) });
    }),
  );

  // DELETE /api/connector-grants/:id
  router.delete(
    "/:id",
    asyncHandler<ConnectorGrantsRequest>(async (req, res) => {
      const ctx = getContext(req, res);
      if (!ctx) return;

      const id = normalizeString(req.params.id);
      if (!id) {
        res.status(400).json({ error: "Grant id is required." });
        return;
      }

      const { rowCount } = await pool.query(
        "delete from connector_grants where id = $1 and workspace_id = $2",
        [id, ctx.workspaceId],
      );
      if (!rowCount) {
        res.status(404).json({ error: "Connector grant not found." });
        return;
      }
      res.status(204).end();
    }),
  );

  return router;
}

export default createConnectorGrantsRoutes;
