/**
 * Admin-console router — mounts every sub-router under
 * /api/admin-console/* with the platform-admin gate applied once.
 *
 * Wire-up from src/app.ts:
 *
 *   import { createAdminConsoleRoutes, createImpersonationVerifyRoute } from "./adminConsole";
 *   app.use("/api/admin-console", requireAuth, createAdminConsoleRoutes(getPostgresPool()));
 *   app.use("/api/impersonation", createImpersonationVerifyRoute());
 *
 * The impersonation verify route is intentionally MOUNTED OUTSIDE the admin
 * gate — the customer dashboard calls it with the impersonation token to
 * validate before rendering the impersonated user's data.
 */

import { Router } from "express";
import type { Pool } from "pg";
import { createRequirePlatformAdmin } from "./requirePlatformAdmin";
import { requireAAL2 } from "../middleware/requireAAL2";
import { createLookupRoutes } from "./lookupRoutes";
import { createIdentityRoutes } from "./identityRoutes";
import { createBillingRoutes } from "./billingRoutes";
import { createProductOpsRoutes } from "./productOpsRoutes";
import { createWorkspaceOpsRoutes } from "./workspaceOpsRoutes";
import { createPendingActionsRoutes } from "./pendingActionsRoutes";
import { createImpersonationRoutes } from "./impersonationRoutes";
import { createAuditRoutes } from "./auditRoutes";
import { createNotesRoutes } from "./notesRoutes";
import { createDataHygieneRoutes } from "./dataHygieneRoutes";
import { createAbuseSignalsRoutes } from "./abuseSignalsRoutes";
import { createCreditsPoolRoutes } from "./creditsPoolRoutes";
import { createInfraRoutes } from "./infra";
import { createAgentWebhookRoutes } from "./agentWebhooks/routes";
import { createAgentReplyRoute } from "./agentWebhooks/replyRoute";
import { createPlatformAdminsRoutes } from "./platformAdminsRoutes";
import { asyncHandler } from "../middleware/asyncHandler";
import { verifyImpersonationToken } from "./impersonationStore";

export function createAdminConsoleRoutes(pool: Pool): Router {
  const router = Router();
  router.use(createRequirePlatformAdmin(pool));

  // HEL-319: require a stepped-up MFA (AAL2) session for the ENTIRE
  // admin-console surface, reads included. Previously only the mutation
  // sub-routers mounted requireAAL2, so every read route (lookup, identity,
  // billing, audit, …) returned cross-tenant customer data to a platform
  // admin holding only a password (AAL1) — bypassing the client-side
  // MfaEnforcementGate entirely via a direct API call. The admin app's
  // apiClient intercepts the resulting `401 mfa_step_up_required` and drives
  // the passkey step-up modal, so this triggers step-up rather than locking
  // the admin out. Mutation routes keep their own requireAAL2 /
  // requireWebAuthnAal2 (the latter is strictly stronger) — redundant but
  // harmless, and they document intent at the callsite.
  router.use(requireAAL2);

  router.use("/lookup", createLookupRoutes(pool));
  router.use("/identity", createIdentityRoutes(pool));
  router.use("/billing", createBillingRoutes(pool));
  router.use("/product-ops", createProductOpsRoutes(pool));
  router.use("/workspace-ops", createWorkspaceOpsRoutes(pool));
  router.use("/pending-actions", createPendingActionsRoutes(pool));
  router.use("/impersonation", createImpersonationRoutes(pool));
  router.use("/audit", createAuditRoutes(pool));
  router.use("/notes", createNotesRoutes(pool));
  router.use("/data-hygiene", createDataHygieneRoutes(pool));
  router.use("/abuse", createAbuseSignalsRoutes(pool));
  router.use("/credits/key-sources", createCreditsPoolRoutes(pool));
  router.use("/infra", createInfraRoutes(pool));
  router.use("/agent-webhooks", createAgentWebhookRoutes(pool));
  router.use("/platform-admins", createPlatformAdminsRoutes(pool));

  return router;
}

/**
 * Public-facing impersonation token verifier — called by the customer
 * dashboard to validate the token before rendering. Returns the impersonated
 * user id + session id + ends_at on success.
 */
export function createImpersonationVerifyRoute(): Router {
  const router = Router();
  router.post(
    "/verify",
    asyncHandler(async (req, res) => {
      const token = String(req.body?.token ?? "").trim();
      if (!token) return res.status(400).json({ error: "token required" });
      try {
        const payload = verifyImpersonationToken(token);
        return res.json({
          valid: true,
          impersonated_user_id: payload.impersonated_user_id,
          impersonator_user_id: payload.impersonator_user_id,
          session_id: payload.session_id,
          ends_at: new Date(payload.exp * 1000).toISOString(),
          mode: payload.mode,
        });
      } catch (err) {
        return res.status(401).json({ valid: false, reason: (err as Error).message });
      }
    }),
  );
  return router;
}

/**
 * Public-facing async agent-ask reply receiver — HEL infra PR #8. Mounted
 * OUTSIDE requireAuth in src/app.ts because external webhook receivers
 * (Slack, n8n, custom agents) don't have AutoFlow sessions. HMAC against
 * the original webhook's stored secret replaces session auth.
 */
export function createPublicAgentReplyRoute(pool: Pool): Router {
  return createAgentReplyRoute(pool);
}

export { createRequirePlatformAdmin } from "./requirePlatformAdmin";
export { recordAdminAction } from "./auditLog";
export { extractAuditContext } from "./types";
