/**
 * connectedAccountStore — persistence for `composio_connected_accounts` (HEL-739 / P1a).
 *
 * A workspace's live Composio connected accounts (its link to a toolkit). Dual-path,
 * mirroring fileObjectStore (HEL-354):
 *  - Postgres (canonical): every op runs inside `withWorkspaceContext` so the
 *    migration-108 RLS policy applies. Belt-and-suspenders, EVERY query also
 *    carries an explicit `workspace_id = $` predicate, so a cross-tenant id
 *    returns 0 rows even if the DB role were ever RLS-bypassing.
 *  - In-memory (dev/test): a process-local Map keyed by workspace, gated by
 *    `inMemoryAllowed()`.
 *
 * Tenancy seam: we persist the bare AutoFlow `workspace_id` (uuid) as the RLS
 * key. The Composio userId (`ws_<id>`) is derived at call time via
 * composioUserId(workspaceId) and is never the RLS key (see broker/config.ts).
 */

import { randomUUID } from "crypto";
import { isPostgresConfigured, inMemoryAllowed, getPostgresPool } from "../../../db/postgres";
import { withWorkspaceContext, withSystemAdminContext } from "../../../middleware/workspaceContext";

export type ComposioConnectionStatus = "INITIATED" | "ACTIVE" | "INACTIVE" | "EXPIRED";

export interface ComposioConnectedAccountRow {
  id: string;
  workspaceId: string;
  toolkit: string;
  connectedAccountId: string;
  authConfigId: string;
  status: ComposioConnectionStatus;
  createdBy: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ComposioWorkspaceContext {
  workspaceId: string;
  userId: string;
}

export interface UpsertConnectedAccountInput {
  toolkit: string;
  connectedAccountId: string;
  authConfigId: string;
  status?: ComposioConnectionStatus;
  createdBy?: string | null;
  metadata?: Record<string, unknown>;
}

// In-memory backend: Map<workspaceId, Map<connectedAccountId, row>>. Production
// uses the "pg" backend (see backend() below); this path is reachable only when
// Postgres is unconfigured AND inMemoryAllowed() (development/test).
// allowlist: dev/test-only fallback when Postgres is unconfigured — never holds prod data of record (HEL-606).
const memStore = new Map<string, Map<string, ComposioConnectedAccountRow>>();

function memWorkspace(workspaceId: string): Map<string, ComposioConnectedAccountRow> {
  let bucket = memStore.get(workspaceId);
  if (!bucket) {
    bucket = new Map();
    memStore.set(workspaceId, bucket);
  }
  return bucket;
}

function backend(): "pg" | "memory" {
  if (isPostgresConfigured()) return "pg";
  if (inMemoryAllowed()) return "memory";
  throw new Error("DATABASE_URL is required for composio_connected_accounts outside development/test");
}

interface ConnectedAccountDbRow {
  id: string;
  workspace_id: string;
  toolkit: string;
  connected_account_id: string;
  auth_config_id: string;
  status: ComposioConnectionStatus;
  created_by: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function rowFromDb(r: ConnectedAccountDbRow): ComposioConnectedAccountRow {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    toolkit: r.toolkit,
    connectedAccountId: r.connected_account_id,
    authConfigId: r.auth_config_id,
    status: r.status,
    createdBy: r.created_by,
    metadata: r.metadata ?? {},
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

export const connectedAccountStore = {
  /**
   * Insert or update a workspace's connected account by its Composio ca_ id.
   * Idempotent: re-running for the same ca_ (e.g. INITIATED -> ACTIVE at the
   * OAuth callback) updates status/auth_config/metadata. The conflict UPDATE is
   * scoped to the same workspace so a ca_ can never be reassigned across tenants.
   */
  async upsert(
    ctx: ComposioWorkspaceContext,
    input: UpsertConnectedAccountInput,
  ): Promise<ComposioConnectedAccountRow> {
    const status = input.status ?? "INITIATED";
    if (backend() === "pg") {
      const pool = getPostgresPool();
      return withWorkspaceContext(pool, ctx, async (client) => {
        const res = await client.query<ConnectedAccountDbRow>(
          `INSERT INTO composio_connected_accounts
             (workspace_id, toolkit, connected_account_id, auth_config_id, status, created_by, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
           ON CONFLICT (connected_account_id) DO UPDATE
             SET status = EXCLUDED.status,
                 auth_config_id = EXCLUDED.auth_config_id,
                 toolkit = EXCLUDED.toolkit,
                 metadata = EXCLUDED.metadata,
                 updated_at = now()
           WHERE composio_connected_accounts.workspace_id = $1
           RETURNING *`,
          [
            ctx.workspaceId,
            input.toolkit,
            input.connectedAccountId,
            input.authConfigId,
            status,
            input.createdBy ?? null,
            JSON.stringify(input.metadata ?? {}),
          ],
        );
        if (!res.rows[0]) {
          // ca_ exists under a different workspace — refuse cross-tenant reassignment.
          throw new Error(
            `composio_connected_accounts: connected_account_id ${input.connectedAccountId} is not owned by this workspace`,
          );
        }
        return rowFromDb(res.rows[0]);
      });
    }

    const bucket = memWorkspace(ctx.workspaceId);
    const existing = bucket.get(input.connectedAccountId);
    const now = new Date().toISOString();
    const row: ComposioConnectedAccountRow = {
      id: existing?.id ?? randomUUID(),
      workspaceId: ctx.workspaceId,
      toolkit: input.toolkit,
      connectedAccountId: input.connectedAccountId,
      authConfigId: input.authConfigId,
      status,
      createdBy: input.createdBy ?? existing?.createdBy ?? null,
      metadata: input.metadata ?? existing?.metadata ?? {},
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    bucket.set(row.connectedAccountId, row);
    return row;
  },

  /** Returns the account only if it belongs to ctx.workspaceId (else null). */
  async getByConnectedAccountId(
    ctx: ComposioWorkspaceContext,
    connectedAccountId: string,
  ): Promise<ComposioConnectedAccountRow | null> {
    if (backend() === "pg") {
      const pool = getPostgresPool();
      return withWorkspaceContext(pool, ctx, async (client) => {
        const res = await client.query<ConnectedAccountDbRow>(
          `SELECT * FROM composio_connected_accounts
           WHERE connected_account_id = $1 AND workspace_id = $2`,
          [connectedAccountId, ctx.workspaceId],
        );
        return res.rows[0] ? rowFromDb(res.rows[0]) : null;
      });
    }
    return memWorkspace(ctx.workspaceId).get(connectedAccountId) ?? null;
  },

  /**
   * Cross-workspace lookup by Composio ca_ id with NO request context (for the
   * inbound webhook, which has no session). Reads under withSystemAdminContext so
   * the migration-108 admin_read (FOR SELECT USING app_is_platform_admin()) policy
   * admits the SELECT; the ca_ id is globally unique, so at most one row.
   */
  async findByConnectedAccountId(
    connectedAccountId: string,
  ): Promise<ComposioConnectedAccountRow | null> {
    if (backend() === "pg") {
      const pool = getPostgresPool();
      return withSystemAdminContext(pool, async (client) => {
        const res = await client.query<ConnectedAccountDbRow>(
          `SELECT * FROM composio_connected_accounts WHERE connected_account_id = $1`,
          [connectedAccountId],
        );
        return res.rows[0] ? rowFromDb(res.rows[0]) : null;
      });
    }
    // In-memory (dev/test): scan every workspace bucket (no RLS).
    for (const bucket of memStore.values()) {
      const row = bucket.get(connectedAccountId);
      if (row) return row;
    }
    return null;
  },

  async listByWorkspace(ctx: ComposioWorkspaceContext): Promise<ComposioConnectedAccountRow[]> {
    if (backend() === "pg") {
      const pool = getPostgresPool();
      return withWorkspaceContext(pool, ctx, async (client) => {
        const res = await client.query<ConnectedAccountDbRow>(
          `SELECT * FROM composio_connected_accounts
           WHERE workspace_id = $1
           ORDER BY created_at DESC`,
          [ctx.workspaceId],
        );
        return res.rows.map(rowFromDb);
      });
    }
    return [...memWorkspace(ctx.workspaceId).values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  },

  async listByToolkit(
    ctx: ComposioWorkspaceContext,
    toolkit: string,
  ): Promise<ComposioConnectedAccountRow[]> {
    if (backend() === "pg") {
      const pool = getPostgresPool();
      return withWorkspaceContext(pool, ctx, async (client) => {
        const res = await client.query<ConnectedAccountDbRow>(
          `SELECT * FROM composio_connected_accounts
           WHERE workspace_id = $1 AND toolkit = $2
           ORDER BY created_at DESC`,
          [ctx.workspaceId, toolkit],
        );
        return res.rows.map(rowFromDb);
      });
    }
    return [...memWorkspace(ctx.workspaceId).values()]
      .filter((r) => r.toolkit === toolkit)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  /** Update the lifecycle status. Returns false if missing/foreign. */
  async markStatus(
    ctx: ComposioWorkspaceContext,
    connectedAccountId: string,
    status: ComposioConnectionStatus,
  ): Promise<boolean> {
    if (backend() === "pg") {
      const pool = getPostgresPool();
      return withWorkspaceContext(pool, ctx, async (client) => {
        const res = await client.query(
          `UPDATE composio_connected_accounts SET status = $3
           WHERE connected_account_id = $1 AND workspace_id = $2`,
          [connectedAccountId, ctx.workspaceId, status],
        );
        return (res.rowCount ?? 0) > 0;
      });
    }
    const row = memWorkspace(ctx.workspaceId).get(connectedAccountId);
    if (!row) return false;
    row.status = status;
    row.updatedAt = new Date().toISOString();
    return true;
  },

  /** Hard-delete the local record (Composio deletion is permanent and handled by the route). */
  async deleteByConnectedAccountId(
    ctx: ComposioWorkspaceContext,
    connectedAccountId: string,
  ): Promise<boolean> {
    if (backend() === "pg") {
      const pool = getPostgresPool();
      return withWorkspaceContext(pool, ctx, async (client) => {
        const res = await client.query(
          `DELETE FROM composio_connected_accounts
           WHERE connected_account_id = $1 AND workspace_id = $2`,
          [connectedAccountId, ctx.workspaceId],
        );
        return (res.rowCount ?? 0) > 0;
      });
    }
    return memWorkspace(ctx.workspaceId).delete(connectedAccountId);
  },

  /** Test-only: clear the in-memory backend. */
  __resetForTests(): void {
    memStore.clear();
  },
};

export type ConnectedAccountStore = typeof connectedAccountStore;
