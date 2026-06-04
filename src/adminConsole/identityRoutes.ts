/**
 * Identity recovery routes — password reset, MFA reset (OTP-confirmed),
 * session revoke. Mounted under /api/admin-console/identity.
 *
 * The MFA reset flow is the most security-sensitive bit:
 *   1. POST /:userId/mfa-reset/request → email a 6-digit OTP to the user
 *   2. POST /:userId/mfa-reset/confirm with the OTP → wipe all factors
 *
 * Both steps audit. The OTP is hashed (sha256) before storage; consumption is
 * single-use; expiry default 15 min.
 */

import { Router } from "express";
import type { Pool } from "pg";
import { createHash, randomInt } from "node:crypto";
import { asyncHandler } from "../middleware/asyncHandler";
import { recordAdminAction } from "./auditLog";
import { consumeRateLimit } from "./rateLimit";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "./supabaseAdminClient";
import { extractAuditContext, type PlatformAdminRequest } from "./types";
import { buildDefaultMfaEmailSender } from "../security/mfaEmailSender";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OTP_TTL_MS = 15 * 60 * 1000;

function hashOtp(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

interface OtpEmailDelivery {
  sendMfaResetOtp(args: { userId: string; otp: string; reason: string }): Promise<void>;
}

/**
 * Default delivery — uses Supabase's admin API to send a transactional email
 * to the user. If you wire up a system mailer (Resend/Postmark) later, swap
 * this implementation.
 *
 * For v1, the OTP is also returned to the admin in the API response so they
 * can read it to the user over the existing support channel. This is
 * intentional — covers the case where the user can't access their email.
 */
const defaultDelivery: OtpEmailDelivery = {
  async sendMfaResetOtp(args): Promise<void> {
    if (!isSupabaseAdminConfigured()) {
      throw new Error("Supabase admin client not configured; cannot send MFA reset OTP.");
    }
    const supa = getSupabaseAdminClient();
    const { data: userResult, error: lookupErr } = await supa.auth.admin.getUserById(args.userId);
    if (lookupErr || !userResult?.user?.email) {
      throw new Error(`Unable to resolve user email for ${args.userId}`);
    }
    // HEL-404: actually email the OTP via the shared transactional mailer
    // (Resend when RESEND_API_KEY is set — AutoFlow's canonical provider —
    // else SendGrid, else a dev logging fallback; the same sender that powers
    // the MFA email factors). The OTP is still returned in the API response
    // (see the route handler) as a deliberate fallback for the "user can't
    // access their email" support path, so a mail failure must not break the
    // reset request — log and continue.
    const sender = buildDefaultMfaEmailSender();
    try {
      await sender.send({
        to: userResult.user.email,
        kind: "email_otp_code",
        code: args.otp,
        purpose: "verify",
      });
    } catch (err) {
      console.error(
        `[admin-console] MFA-reset OTP email to ${userResult.user.email} failed (reason: ${args.reason}): ${
          (err as Error).message
        }`,
      );
    }
  },
};

export interface IdentityRouteDeps {
  /** Override the OTP email delivery (test injection point). */
  delivery?: OtpEmailDelivery;
}

export function createIdentityRoutes(_pool: Pool, deps: IdentityRouteDeps = {}): Router {
  const router = Router();
  const delivery = deps.delivery ?? defaultDelivery;

  // POST /:userId/password-reset
  router.post(
    "/:userId/password-reset",
    asyncHandler(async (req, res) => {
      const userId = req.params.userId;
      if (!UUID_RE.test(userId)) return res.status(400).json({ error: "invalid user id" });

      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) return res.status(400).json({ error: "reason required" });

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      consumeRateLimit(admin, "password_resets");

      // Audit FIRST, side-effect SECOND.
      await recordAdminAction(client, {
        adminUserId: admin,
        action: "generate_password_reset_link",
        targetUserId: userId,
        reason,
        context: extractAuditContext(req),
      });

      if (!isSupabaseAdminConfigured()) {
        return res.status(503).json({ error: "Supabase admin not configured" });
      }
      const supa = getSupabaseAdminClient();
      const { data: userResult, error: lookupErr } = await supa.auth.admin.getUserById(userId);
      if (lookupErr || !userResult?.user?.email) {
        return res.status(404).json({ error: "user not found" });
      }
      const { data: linkData, error: linkErr } = await supa.auth.admin.generateLink({
        type: "recovery",
        email: userResult.user.email,
      });
      if (linkErr || !linkData) {
        return res.status(502).json({ error: "supabase.generateLink failed", detail: linkErr?.message });
      }

      return res.json({
        link: linkData.properties?.action_link ?? null,
        email: userResult.user.email,
      });
    }),
  );

  // POST /:userId/revoke-sessions
  router.post(
    "/:userId/revoke-sessions",
    asyncHandler(async (req, res) => {
      const userId = req.params.userId;
      if (!UUID_RE.test(userId)) return res.status(400).json({ error: "invalid user id" });

      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) return res.status(400).json({ error: "reason required" });

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "revoke_user_sessions",
        targetUserId: userId,
        reason,
        context: extractAuditContext(req),
      });

      if (!isSupabaseAdminConfigured()) {
        return res.status(503).json({ error: "Supabase admin not configured" });
      }
      const supa = getSupabaseAdminClient();
      const { error } = await supa.auth.admin.signOut(userId, "global");
      if (error) {
        return res.status(502).json({ error: "supabase.signOut failed", detail: error.message });
      }
      return res.json({ ok: true });
    }),
  );

  // POST /:userId/mfa-reset/request
  router.post(
    "/:userId/mfa-reset/request",
    asyncHandler(async (req, res) => {
      const userId = req.params.userId;
      if (!UUID_RE.test(userId)) return res.status(400).json({ error: "invalid user id" });
      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) return res.status(400).json({ error: "reason required" });

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      consumeRateLimit(admin, "mfa_resets");

      // Cancel any in-flight requests for this user — only one active OTP at
      // a time so a stale OTP can't be reused.
      await client.query(
        `UPDATE mfa_reset_requests
            SET cancelled_at = now()
          WHERE user_id = $1 AND consumed_at IS NULL AND cancelled_at IS NULL`,
        [userId],
      );

      const otp = generateOtp();
      const expiresAt = new Date(Date.now() + OTP_TTL_MS);

      const insert = await client.query<{ id: string }>(
        `INSERT INTO mfa_reset_requests (user_id, admin_user_id, otp_hash, reason, expires_at)
              VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
        [userId, admin, hashOtp(otp), reason, expiresAt.toISOString()],
      );

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "request_mfa_reset",
        targetUserId: userId,
        reason,
        payload: { request_id: insert.rows[0].id, expires_at: expiresAt.toISOString() },
        context: extractAuditContext(req),
      });

      try {
        await delivery.sendMfaResetOtp({ userId, otp, reason });
      } catch (err) {
        console.error("[admin-console/identity] OTP delivery failed:", (err as Error).message);
        // Don't fail the request — admin can still read the OTP from the
        // response body (covers the "user can't access email" case).
      }

      return res.json({
        request_id: insert.rows[0].id,
        expires_at: expiresAt.toISOString(),
        // The plaintext OTP is returned ONLY to the admin and ONLY in this
        // response; never logged.
        otp,
      });
    }),
  );

  // POST /:userId/mfa-reset/confirm
  router.post(
    "/:userId/mfa-reset/confirm",
    asyncHandler(async (req, res) => {
      const userId = req.params.userId;
      if (!UUID_RE.test(userId)) return res.status(400).json({ error: "invalid user id" });
      const otp = String(req.body?.otp ?? "").trim();
      if (!/^[0-9]{6}$/.test(otp)) return res.status(400).json({ error: "otp must be 6 digits" });

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      const lookup = await client.query<{ id: string; reason: string }>(
        `UPDATE mfa_reset_requests
            SET consumed_at = now()
          WHERE user_id = $1
            AND otp_hash = $2
            AND consumed_at IS NULL
            AND cancelled_at IS NULL
            AND expires_at > now()
          RETURNING id, reason`,
        [userId, hashOtp(otp)],
      );

      if (lookup.rowCount === 0) {
        return res.status(401).json({ error: "invalid or expired otp" });
      }

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "execute_mfa_reset",
        targetUserId: userId,
        reason: lookup.rows[0].reason,
        payload: { request_id: lookup.rows[0].id },
        context: extractAuditContext(req),
      });

      if (!isSupabaseAdminConfigured()) {
        return res.status(503).json({ error: "Supabase admin not configured" });
      }
      const supa = getSupabaseAdminClient();
      const { data: factors, error: listErr } = await supa.auth.admin.mfa.listFactors({
        userId,
      });
      if (listErr) {
        return res.status(502).json({ error: "supabase.mfa.listFactors failed", detail: listErr.message });
      }
      const factorList = factors?.factors ?? [];
      const errors: string[] = [];
      for (const factor of factorList) {
        const { error: delErr } = await supa.auth.admin.mfa.deleteFactor({
          userId,
          id: factor.id,
        });
        if (delErr) errors.push(`${factor.id}: ${delErr.message}`);
      }
      if (errors.length > 0) {
        return res
          .status(502)
          .json({ error: "some factors failed to delete", detail: errors });
      }

      return res.json({ ok: true, factors_deleted: factorList.length });
    }),
  );

  return router;
}
