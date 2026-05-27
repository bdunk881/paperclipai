/**
 * Audit-log writer — the chokepoint every privileged admin-console operation
 * MUST call BEFORE issuing the underlying privileged side-effect.
 *
 * The order matters: write the audit row first, then fire the action. If the
 * audit insert fails, the action does not run. This way a malicious admin
 * cannot perform an action without leaving a receipt, even by triggering an
 * audit-table error.
 *
 * The platform_admin_audit_log table is append-only at the RLS level (see
 * migration 059), so we do not need to guard against UPDATE/DELETE here.
 */

import type { Pool, PoolClient } from "pg";
import { ADMIN_ACTIONS, type AdminAction, type AdminAuditContext } from "./types";

export interface RecordAdminActionParams {
  adminUserId: string;
  action: AdminAction;
  targetUserId?: string | null;
  targetWorkspaceId?: string | null;
  reason?: string;
  payload?: Record<string, unknown>;
  context?: AdminAuditContext;
}

const VALID_ACTIONS = new Set<string>(ADMIN_ACTIONS);

/**
 * Inserts an audit row. Accepts either a Pool (for one-off writes) or a
 * PoolClient already inside a transaction (so the audit + the side-effect
 * commit/rollback together).
 *
 * Returns the inserted row's id.
 */
export async function recordAdminAction(
  conn: Pool | PoolClient,
  params: RecordAdminActionParams,
): Promise<string> {
  if (!params.adminUserId || params.adminUserId.length === 0) {
    throw new Error("recordAdminAction: adminUserId required");
  }
  if (!VALID_ACTIONS.has(params.action)) {
    throw new Error(`recordAdminAction: unknown action "${params.action}"`);
  }

  const payload = params.payload && typeof params.payload === "object" ? params.payload : {};

  const result = await conn.query<{ id: string }>(
    `INSERT INTO platform_admin_audit_log
      (admin_user_id, action, target_user_id, target_workspace_id, reason, payload, ip, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::inet, $8)
      RETURNING id`,
    [
      params.adminUserId,
      params.action,
      params.targetUserId ?? null,
      params.targetWorkspaceId ?? null,
      params.reason ?? "",
      JSON.stringify(payload),
      params.context?.ip ?? null,
      params.context?.userAgent ?? null,
    ],
  );

  return result.rows[0].id;
}
