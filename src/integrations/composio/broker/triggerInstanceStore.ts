/**
 * triggerInstanceStore — persistence for `composio_trigger_instances` (HEL-764 / P4-0).
 *
 * A workspace's live Composio TRIGGER subscriptions: a (toolkit, trigger_slug)
 * bound to a connected account (ca_) and the AGENT it wakes, keyed by the
 * globally-unique Composio trigger id (ti_). Dual-path, mirroring
 * connectedAccountStore (HEL-739):
 *  - Postgres (canonical): every op runs inside `withWorkspaceContext` so the
 *    migration-109 RLS policy applies; every query ALSO carries an explicit
 *    `workspace_id` predicate (belt-and-suspenders cross-tenant guard).
 *  - In-memory (dev/test): a process-local Map keyed by workspace.
 *
 * The sessionless trigger webhook (P4-b) reads a row by ti_ via `findByTriggerId`
 * under `withSystemAdminContext` (the migration-109 admin_read policy), exactly
 * like connectedAccountStore.findByConnectedAccountId.
 */

import { randomUUID } from "crypto";
import { isPostgresConfigured, inMemoryAllowed, getPostgresPool } from "../../../db/postgres";
import { withWorkspaceContext, withSystemAdminContext } from "../../../middleware/workspaceContext";
import type { ComposioWorkspaceContext } from "./connectedAccountStore";

export type { ComposioWorkspaceContext } from "./connectedAccountStore";

export type ComposioTriggerStatus = "ENABLED" | "DISABLED" | "ERROR";

export interface ComposioTriggerInstanceRow {
  id: string;
  workspaceId: string;
  agentId: string;
  toolkit: string;
  triggerSlug: string;
  /** Composio trigger instance id (ti_…), globally unique. */
  triggerId: string;
  connectedAccountId: string;
  triggerConfig: Record<string, unknown>;
  status: ComposioTriggerStatus;
  createdBy: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTriggerInstanceInput {
  agentId: string;
  toolkit: string;
  triggerSlug: string;
  triggerId: string;
  connectedAccountId: string;
  triggerConfig?: Record<string, unknown>;
  status?: ComposioTriggerStatus;
  createdBy?: string | null;
  metadata?: Record<string, unknown>;
}

// In-memory backend: Map<workspaceId, Map<triggerId, row>>. Production uses the
// "pg" backend; this path is reachable only when Postgres is unconfigured AND
// inMemoryAllowed() (development/test).
// allowlist: dev/test-only fallback when Postgres is unconfigured — never holds prod data of record (HEL-606).
const memStore = new Map<string, Map<string, ComposioTriggerInstanceRow>>();

function memWorkspace(workspaceId: string): Map<string, ComposioTriggerInstanceRow> {
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
  throw new Error("DATABASE_URL is required for composio_trigger_instances outside development/test");
}

interface TriggerInstanceDbRow {
  id: string;
  workspace_id: string;
  agent_id: string;
  toolkit: string;
  trigger_slug: string;
  trigger_id: string;
  connected_account_id: string;
  trigger_config: Record<string, unknown> | null;
  status: ComposioTriggerStatus;
  created_by: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function rowFromDb(r: TriggerInstanceDbRow): ComposioTriggerInstanceRow {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    agentId: r.agent_id,
    toolkit: r.toolkit,
    triggerSlug: r.trigger_slug,
    triggerId: r.trigger_id,
    connectedAccountId: r.connected_account_id,
    triggerConfig: r.trigger_config ?? {},
    status: r.status,
    createdBy: r.created_by,
    metadata: r.metadata ?? {},
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

export const triggerInstanceStore = {
  /**
   * Insert or update a trigger subscription by its Composio ti_ id. Idempotent:
   * re-subscribing the same ti_ updates the binding/config/status. The conflict
   * UPDATE is scoped to the same workspace so a ti_ can never be reassigned
   * across tenants.
   */
  async create(
    ctx: ComposioWorkspaceContext,
    input: CreateTriggerInstanceInput,
  ): Promise<ComposioTriggerInstanceRow> {
    const status = input.status ?? "ENABLED";
    if (backend() === "pg") {
      const pool = getPostgresPool();
      return withWorkspaceContext(pool, ctx, async (client) => {
        const res = await client.query<TriggerInstanceDbRow>(
          `INSERT INTO composio_trigger_instances
             (workspace_id, agent_id, toolkit, trigger_slug, trigger_id, connected_account_id, trigger_config, status, created_by, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb)
           ON CONFLICT (trigger_id) DO UPDATE
             SET agent_id = EXCLUDED.agent_id,
                 toolkit = EXCLUDED.toolkit,
                 trigger_slug = EXCLUDED.trigger_slug,
                 connected_account_id = EXCLUDED.connected_account_id,
                 trigger_config = EXCLUDED.trigger_config,
                 status = EXCLUDED.status,
                 metadata = EXCLUDED.metadata,
                 updated_at = now()
           WHERE composio_trigger_instances.workspace_id = $1
           RETURNING *`,
          [
            ctx.workspaceId,
            input.agentId,
            input.toolkit,
            input.triggerSlug,
            input.triggerId,
            input.connectedAccountId,
            JSON.stringify(input.triggerConfig ?? {}),
            status,
            input.createdBy ?? null,
            JSON.stringify(input.metadata ?? {}),
          ],
        );
        if (!res.rows[0]) {
          // ti_ exists under a different workspace — refuse cross-tenant reassignment.
          throw new Error(
            `composio_trigger_instances: trigger_id ${input.triggerId} is not owned by this workspace`,
          );
        }
        return rowFromDb(res.rows[0]);
      });
    }

    const bucket = memWorkspace(ctx.workspaceId);
    const existing = bucket.get(input.triggerId);
    const now = new Date().toISOString();
    const row: ComposioTriggerInstanceRow = {
      id: existing?.id ?? randomUUID(),
      workspaceId: ctx.workspaceId,
      agentId: input.agentId,
      toolkit: input.toolkit,
      triggerSlug: input.triggerSlug,
      triggerId: input.triggerId,
      connectedAccountId: input.connectedAccountId,
      triggerConfig: input.triggerConfig ?? existing?.triggerConfig ?? {},
      status,
      createdBy: input.createdBy ?? existing?.createdBy ?? null,
      metadata: input.metadata ?? existing?.metadata ?? {},
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    bucket.set(row.triggerId, row);
    return row;
  },

  /**
   * Cross-workspace lookup by Composio ti_ id with NO request context (for the
   * inbound trigger webhook, which has no session). Reads under
   * withSystemAdminContext so the migration-109 admin_read policy admits the
   * SELECT; the ti_ id is globally unique, so at most one row.
   */
  async findByTriggerId(triggerId: string): Promise<ComposioTriggerInstanceRow | null> {
    if (backend() === "pg") {
      const pool = getPostgresPool();
      return withSystemAdminContext(pool, async (client) => {
        const res = await client.query<TriggerInstanceDbRow>(
          `SELECT * FROM composio_trigger_instances WHERE trigger_id = $1`,
          [triggerId],
        );
        return res.rows[0] ? rowFromDb(res.rows[0]) : null;
      });
    }
    for (const bucket of memStore.values()) {
      const row = bucket.get(triggerId);
      if (row) return row;
    }
    return null;
  },

  /**
   * Sessionless lookup by (trigger_slug, connected_account_id) — the natural key
   * the inbound trigger webhook uses to route a fired event to its bound agent.
   * A ca_ is globally unique to one workspace, so (slug, ca_) is unambiguous.
   * Reads under withSystemAdminContext (the migration-109 admin_read policy).
   */
  async findBySlugAndConnectedAccount(
    triggerSlug: string,
    connectedAccountId: string,
  ): Promise<ComposioTriggerInstanceRow | null> {
    if (backend() === "pg") {
      const pool = getPostgresPool();
      return withSystemAdminContext(pool, async (client) => {
        const res = await client.query<TriggerInstanceDbRow>(
          `SELECT * FROM composio_trigger_instances
           WHERE trigger_slug = $1 AND connected_account_id = $2
           ORDER BY created_at DESC
           LIMIT 1`,
          [triggerSlug, connectedAccountId],
        );
        return res.rows[0] ? rowFromDb(res.rows[0]) : null;
      });
    }
    for (const bucket of memStore.values()) {
      for (const row of bucket.values()) {
        if (row.triggerSlug === triggerSlug && row.connectedAccountId === connectedAccountId) {
          return row;
        }
      }
    }
    return null;
  },

  async listByWorkspace(ctx: ComposioWorkspaceContext): Promise<ComposioTriggerInstanceRow[]> {
    if (backend() === "pg") {
      const pool = getPostgresPool();
      return withWorkspaceContext(pool, ctx, async (client) => {
        const res = await client.query<TriggerInstanceDbRow>(
          `SELECT * FROM composio_trigger_instances
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

  /** Update the lifecycle status. Returns false if missing/foreign. */
  async markStatus(
    ctx: ComposioWorkspaceContext,
    triggerId: string,
    status: ComposioTriggerStatus,
  ): Promise<boolean> {
    if (backend() === "pg") {
      const pool = getPostgresPool();
      return withWorkspaceContext(pool, ctx, async (client) => {
        const res = await client.query(
          `UPDATE composio_trigger_instances SET status = $3
           WHERE trigger_id = $1 AND workspace_id = $2`,
          [triggerId, ctx.workspaceId, status],
        );
        return (res.rowCount ?? 0) > 0;
      });
    }
    const row = memWorkspace(ctx.workspaceId).get(triggerId);
    if (!row) return false;
    row.status = status;
    row.updatedAt = new Date().toISOString();
    return true;
  },

  /** Hard-delete the local record (Composio deletion is handled by the service). */
  async deleteByTriggerId(ctx: ComposioWorkspaceContext, triggerId: string): Promise<boolean> {
    if (backend() === "pg") {
      const pool = getPostgresPool();
      return withWorkspaceContext(pool, ctx, async (client) => {
        const res = await client.query(
          `DELETE FROM composio_trigger_instances
           WHERE trigger_id = $1 AND workspace_id = $2`,
          [triggerId, ctx.workspaceId],
        );
        return (res.rowCount ?? 0) > 0;
      });
    }
    return memWorkspace(ctx.workspaceId).delete(triggerId);
  },

  /** Test-only: clear the in-memory backend. */
  __resetForTests(): void {
    memStore.clear();
  },
};

export type TriggerInstanceStore = typeof triggerInstanceStore;
