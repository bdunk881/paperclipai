/**
 * Shared types for the admin-console backend.
 *
 * The admin console is a separate Vite app at admin.helloautoflow.com that
 * talks to the API under /api/admin-console/*. All routes are gated by
 * `requirePlatformAdmin` which validates the user's `is_platform_admin` flag
 * and sets `app.is_platform_admin = 'true'` on the DB transaction.
 */

import type { Request } from "express";
import type { AuthenticatedRequest } from "../auth/authMiddleware";

/**
 * The set of action verbs the audit log accepts. New verbs must be added
 * here (the writer rejects unknown verbs) — keeps the audit surface honest.
 */
export const ADMIN_ACTIONS = [
  // identity
  "lookup_user",
  "list_workspaces",
  "view_user",
  "generate_password_reset_link",
  "request_mfa_reset",
  "execute_mfa_reset",
  "revoke_user_sessions",
  "start_impersonation",
  "end_impersonation",
  "impersonation_navigation",

  // billing
  "issue_refund",
  "grant_credit",
  "extend_trial",
  "change_plan",
  "void_invoice",
  "resend_invoice",

  // product ops
  "view_activity",
  "view_run_replay",
  "execute_run_replay",
  "force_integration_refresh",
  "clear_user_cache",
  "set_feature_override",
  "clear_feature_override",

  // workspace ops
  "lock_workspace",
  "unlock_workspace",
  "queue_suspend_workspace",
  "confirm_suspend_workspace",
  "cancel_pending_action",
  "set_workspace_budget_pause",
  "queue_transfer_ownership",
  "confirm_transfer_ownership",

  // data hygiene
  "create_note",
  "update_note",
  "delete_note",
  "queue_data_export",
  "queue_user_erasure",
  "confirm_user_erasure",
  "anonymize_user",

  // abuse
  "view_failed_logins",
  "view_login_devices",

  // HEL-250 credits pool (platform_provider_keys CRUD)
  "list_provider_keys",
  "create_provider_key",
  "update_provider_key",
  "rotate_provider_key",
  "disable_provider_key",
] as const;

export type AdminAction = (typeof ADMIN_ACTIONS)[number];

/**
 * An authenticated request with a populated platform-admin context. Set by
 * `requirePlatformAdmin` middleware.
 */
export interface PlatformAdminRequest extends AuthenticatedRequest {
  platformAdmin: {
    userId: string;
    email: string | null;
  };
}

/** Subset of a Request useful for capturing audit context. */
export interface AdminAuditContext {
  ip: string | null;
  userAgent: string | null;
}

export function extractAuditContext(req: Request): AdminAuditContext {
  const xff = req.headers["x-forwarded-for"];
  const ipHeader = Array.isArray(xff) ? xff[0] : xff;
  return {
    ip: (typeof ipHeader === "string" && ipHeader.split(",")[0]?.trim()) || req.ip || null,
    userAgent: req.get("user-agent") ?? null,
  };
}
