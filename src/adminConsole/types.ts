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

  // HEL-599 Stripe Issuing treasury
  "list_treasury",
  "provision_issuing_cards",

  // infra dashboard reads (HEL infra PR #2)
  "view_infra_overview",
  "view_infra_compute",
  // infra edge reads (HEL infra PR #4)
  "view_infra_edge",
  // infra data reads (HEL infra PR #5)
  "view_infra_data",

  // infra cost reads (HEL infra follow-up)
  "view_infra_cost",
  // cost threshold management (HEL infra follow-up)
  "create_cost_threshold",
  "update_cost_threshold",
  "disable_cost_threshold",

  // platform admin lifecycle (HEL infra follow-up)
  // Grant is intentionally NOT a verb — granting happens out-of-band
  // via SQL / env var to prevent privilege escalation from the dashboard.
  "list_platform_admins",
  "revoke_platform_admin",

  // infra compute mutations (HEL infra PR #6)
  "restart_fly_machine",
  "retry_queue_job",
  "promote_queue_job",
  "remove_queue_job",
  "replay_dlq_job",
  "pause_queue",
  "resume_queue",
  "drain_queue",
  "trigger_scheduled_job",

  // infra edge mutations (HEL infra PR #7)
  "rollback_cf_pages_deploy",
  "retry_cf_pages_deploy",
  "rerun_workflow_run",
  "cancel_workflow_run",

  // infra data mutations (HEL infra PR #7)
  "kill_postgres_query",
  "flush_redis_pattern",

  // agent webhooks (HEL infra PR #2)
  "create_agent_webhook",
  "update_agent_webhook",
  "disable_agent_webhook",
  "delete_agent_webhook",
  "test_agent_webhook",
  "ask_agent",

  // system status notices (HEL-366)
  "send_system_notice",
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
