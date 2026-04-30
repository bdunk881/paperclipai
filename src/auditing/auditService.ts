/**
 * Centralized cross-phase audit log service (ALT-2078 / ALT-1915 Phase 5).
 *
 * Single emit surface for tenant-mutating actions across every phase of the
 * multi-tenant isolation programme. Persists to `control_plane_audit_log`,
 * which is workspace-scoped, FORCE RLS, and append-only enforced (migration
 * 020).
 *
 * Coexists with `control_plane_secret_audit` (migration 017/018) during the
 * deprecation window. Secret callsites continue to write to both ledgers; new
 * callsites should use this service exclusively.
 */
import type { Pool, PoolClient } from "pg";
import { getPostgresPool } from "../db/postgres";
import { withWorkspaceContext } from "../middleware/workspaceContext";

export type AuditCategory =
  | "secret"
  | "provisioning"
  | "team_lifecycle"
  | "agent_lifecycle"
  | "execution"
  | "auth"
  | "bypass_attempt";

export interface AuditContext {
  workspaceId: string;
  userId: string;
  actorUserId?: string | null;
  actorAgentId?: string | null;
}

export interface AuditTarget {
  type: string;
  id: string;
}

export interface AuditEntry {
  category: AuditCategory;
  action: string;
  target?: AuditTarget | null;
  metadata?: Record<string, unknown> | null;
}

const ACTION_MAX_LENGTH = 64;

function resolveActor(ctx: AuditContext): {
  actorUserId: string | null;
  actorAgentId: string | null;
} {
  const actorUserId = ctx.actorUserId?.trim() || null;
  const actorAgentId = ctx.actorAgentId?.trim() || null;
  if (!actorUserId && !actorAgentId) {
    // Mirror the DB CHECK so callers fail fast in app code instead of
    // surfacing a constraint-violation error from Postgres.
    throw new Error("audit_actor_required");
  }
  return { actorUserId, actorAgentId };
}

function validateAction(action: string): string {
  const trimmed = action.trim();
  if (!trimmed) {
    throw new Error("audit_action_required");
  }
  if (trimmed.length > ACTION_MAX_LENGTH) {
    throw new Error("audit_action_too_long");
  }
  return trimmed;
}

async function insertAuditRow(
  client: PoolClient,
  workspaceId: string,
  actorUserId: string | null,
  actorAgentId: string | null,
  entry: AuditEntry,
): Promise<void> {
  const action = validateAction(entry.action);
  await client.query(
    `INSERT INTO control_plane_audit_log (
       workspace_id, actor_user_id, actor_agent_id,
       category, action, target_type, target_id, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      workspaceId,
      actorUserId,
      actorAgentId,
      entry.category,
      action,
      entry.target?.type ?? null,
      entry.target?.id ?? null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
    ],
  );
}

/**
 * Emit a single audit row in its own workspace-scoped transaction.
 *
 * Use this when no other tenant write is in flight. If the action is part of
 * a larger transaction (e.g. provisioning + audit), use `recordActionWithin`
 * so the audit row commits atomically with the mutation it describes.
 */
export async function recordAction(
  ctx: AuditContext,
  entry: AuditEntry,
  pool: Pool = getPostgresPool(),
): Promise<void> {
  const { actorUserId, actorAgentId } = resolveActor(ctx);
  await withWorkspaceContext(
    pool,
    { workspaceId: ctx.workspaceId, userId: ctx.userId },
    async (client) => {
      await insertAuditRow(client, ctx.workspaceId, actorUserId, actorAgentId, entry);
    },
  );
}

/**
 * Emit an audit row using a caller-provided PoolClient that already has
 * workspace context set. Use this from inside an existing
 * `withWorkspaceContext` block so the audit row commits or rolls back with
 * the mutation it describes.
 */
export async function recordActionWithin(
  client: PoolClient,
  ctx: AuditContext,
  entry: AuditEntry,
): Promise<void> {
  const { actorUserId, actorAgentId } = resolveActor(ctx);
  await insertAuditRow(client, ctx.workspaceId, actorUserId, actorAgentId, entry);
}

export const auditService = {
  recordAction,
  recordActionWithin,
};

export type AuditService = typeof auditService;
