/**
 * Platform-admin lifecycle routes (HEL infra follow-up).
 *
 * Mounted at /api/admin-console/platform-admins. Surfaces:
 *
 *   GET  /                      — list active platform admins (read)
 *   POST /:userId/revoke        — revoke a platform-admin grant
 *
 * NOTE: there is intentionally NO grant endpoint. Granting must happen
 * out-of-band (Supabase SQL editor or AUTOFLOW_STAFF_USER_IDS env var)
 * so a stolen-session attacker who somehow reaches the admin app cannot
 * elevate themselves OR a buddy. The dashboard is offboarding-only.
 *
 * Revoke is gated by requireWebAuthnAal2 — TOTP step-up is NOT
 * sufficient. The revoke handler also enforces:
 *   - Cannot revoke your own admin grant
 *   - Cannot revoke the LAST admin (would lock everyone out)
 */

import { Router } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireWebAuthnAal2 } from "../middleware/requireWebAuthnAal2";
import { recordAdminAction } from "./auditLog";
import { consumeRateLimit } from "./rateLimit";
import { extractAuditContext, type PlatformAdminRequest } from "./types";
import {
  getSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "./supabaseAdminClient";

interface PlatformAdminRow {
  user_id: string;
  display_name: string | null;
  is_platform_admin: boolean;
  created_at: string | null;
}

export interface PlatformAdminView {
  user_id: string;
  display_name: string | null;
  email: string | null;
  granted_at: string | null;
}

async function listPlatformAdmins(
  conn: import("pg").PoolClient,
): Promise<PlatformAdminView[]> {
  const result = await conn.query<PlatformAdminRow>(
    `SELECT user_id, display_name, is_platform_admin, created_at
       FROM user_profiles
      WHERE is_platform_admin = true
      ORDER BY created_at ASC NULLS LAST, user_id ASC`,
  );

  // Decorate with email from Supabase when the admin client is
  // configured. We do this in a loop because the JS SDK's admin user
  // lookup is per-id; pagination of listUsers would be heavier and we
  // expect <20 platform admins.
  if (!isSupabaseAdminConfigured()) {
    return result.rows.map((r) => ({
      user_id: r.user_id,
      display_name: r.display_name,
      email: null,
      granted_at: r.created_at,
    }));
  }

  const supa = getSupabaseAdminClient();
  const rows: PlatformAdminView[] = [];
  for (const r of result.rows) {
    let email: string | null = null;
    try {
      const got = await supa.auth.admin.getUserById(r.user_id);
      email = got.data.user?.email ?? null;
    } catch {
      // Best-effort — surface the row with email=null if lookup fails.
    }
    rows.push({
      user_id: r.user_id,
      display_name: r.display_name,
      email,
      granted_at: r.created_at,
    });
  }
  return rows;
}

export function createPlatformAdminsRoutes(_pool: Pool): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      await recordAdminAction(client, {
        adminUserId: r.platformAdmin.userId,
        action: "list_platform_admins",
        reason: "",
        context: extractAuditContext(req),
      });
      const admins = await listPlatformAdmins(client);
      res.json({ admins, self_user_id: r.platformAdmin.userId });
    }),
  );

  // Revoke — strict WebAuthn step-up + same-user guard + last-admin
  // guard. We hold the transaction across the count check + flag flip so
  // a concurrent revoke can't squeak through to leave 0 admins.
  router.post(
    "/:userId/revoke",
    requireWebAuthnAal2,
    asyncHandler(async (req, res) => {
      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminId = r.platformAdmin.userId;
      const targetId = String(req.params.userId ?? "").trim();
      const reason = (() => {
        const v = (req.body as { reason?: unknown } | undefined)?.reason;
        if (typeof v !== "string") return null;
        const t = v.trim();
        return t.length >= 8 ? t : null;
      })();
      const confirm = String(
        (req.body as { confirm?: unknown } | undefined)?.confirm ?? "",
      ).trim();

      if (!/^[0-9a-f-]{36}$/.test(targetId)) {
        return res.status(400).json({ error: "invalid_user_id" });
      }
      if (!reason) {
        return res.status(400).json({ error: "reason_required_min_8_chars" });
      }
      if (confirm !== "REVOKE") {
        return res.status(400).json({
          error: "confirm_required",
          hint: "Type REVOKE into the confirm field to proceed.",
        });
      }
      if (targetId === adminId) {
        return res.status(400).json({ error: "cannot_revoke_self" });
      }

      try {
        consumeRateLimit(adminId, "revoke_platform_admin");
      } catch {
        return res.status(429).json({ error: "rate_limited", bucket: "revoke_platform_admin" });
      }

      // Confirm the target is currently a platform admin, AND we'd still
      // have at least one admin remaining after the flip.
      const status = await client.query<{
        target_is_admin: boolean;
        active_count: string;
      }>(
        `SELECT
           (SELECT COALESCE(is_platform_admin, false)
              FROM user_profiles WHERE user_id = $1) AS target_is_admin,
           (SELECT COUNT(*)::text
              FROM user_profiles
             WHERE is_platform_admin = true) AS active_count`,
        [targetId],
      );
      const row = status.rows[0];
      if (!row || !row.target_is_admin) {
        return res.status(404).json({ error: "target_not_an_admin" });
      }
      const remaining = Number(row.active_count) - 1;
      if (remaining < 1) {
        return res.status(409).json({
          error: "would_leave_zero_admins",
          hint: "Grant another admin via SQL / env var before revoking this one.",
        });
      }

      // Audit BEFORE the side-effect.
      await recordAdminAction(client, {
        adminUserId: adminId,
        action: "revoke_platform_admin",
        targetUserId: targetId,
        reason,
        payload: { remaining_after: remaining },
        context: extractAuditContext(req),
      });

      const upd = await client.query(
        `UPDATE user_profiles
            SET is_platform_admin = false
          WHERE user_id = $1 AND is_platform_admin = true`,
        [targetId],
      );
      if ((upd.rowCount ?? 0) === 0) {
        // Lost to a concurrent revoke — roll back will fire via the
        // transaction guard. Surface the conflict to the caller.
        return res.status(409).json({ error: "concurrent_revoke" });
      }

      res.json({ ok: true, target_user_id: targetId, remaining_active: remaining });
    }),
  );

  return router;
}
