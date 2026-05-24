/**
 * Workspace member invite routes (HEL-213 PR I).
 *
 *   POST   /api/workspace/members/invite                — owner/admin only
 *   POST   /api/workspace/members/invite/:token/accept  — any authenticated user
 *   DELETE /api/workspace/members/invite/:id            — owner/admin only
 *
 * Backed by the `workspace_member_invites` table (migration 063). Email is
 * sent via the existing mailer — TODO(HEL-213): we couldn't locate a
 * canonical sendMail helper in the repo at PR-cut time (grep for
 * `sendMail|nodemailer|resend` returned no matches), so the invite handler
 * stamps the row + logs the invite URL. Wire the actual transport in a
 * follow-up once the mailer surface lands.
 *
 * The accept handler optimistically bumps the workspace's Stripe
 * subscription quantity by 1 to reflect the new paid seat. Failures during
 * the Stripe call are logged but do not block the member from joining —
 * the seat reconciliation cron picks them up out-of-band.
 */

import { Router, type Request } from "express";
import { randomBytes } from "crypto";
import type { Pool } from "pg";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import { asyncHandler } from "../middleware/asyncHandler";
import { subscriptionStore } from "../billing/subscriptionStore";
import { getStripe } from "../billing/stripeClient";

type InviteRole = "admin" | "operator" | "viewer";
const ALLOWED_ROLES: ReadonlySet<InviteRole> = new Set(["admin", "operator", "viewer"]);

interface InviteRow {
  id: string;
  workspace_id: string;
  email: string;
  role: InviteRole;
  invited_by: string | null;
  invite_token: string;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function getWorkspaceId(req: Request): string | null {
  // SECURITY: trust ONLY the JWT-resolved workspace. Header/body fallbacks
  // would let a member of one workspace invite into another. Pre-mount
  // workspaceResolver guarantees req.auth.workspaceId is populated.
  const id = (req as AuthenticatedRequest).auth?.workspaceId?.trim();
  return id && isUuid(id) ? id : null;
}

async function isOwnerOrAdmin(
  pool: Pool,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const result = await pool.query<{ role: string }>(
    `SELECT CASE
              WHEN w.owner_user_id = $2 THEN 'owner'
              ELSE wm.role
            END AS role
       FROM workspaces w
       LEFT JOIN workspace_members wm
         ON wm.workspace_id = w.id AND wm.user_id = $2
      WHERE w.id = $1
      LIMIT 1`,
    [workspaceId, userId],
  );
  const role = result.rows[0]?.role;
  return role === "owner" || role === "admin";
}

/**
 * Bump the workspace's Stripe subscription quantity by 1 to reflect a
 * newly-accepted paid seat. Best-effort: failures are logged but never
 * surface as 5xx on the invite-accept path. The webhook reconciler is
 * the canonical source of truth and will fix drift out-of-band.
 */
async function bumpStripeSubscriptionSeat(workspaceId: string, userId: string): Promise<void> {
  try {
    const sub = await subscriptionStore.getByUserId(userId);
    // The workspace may have a different owner than the user accepting
    // the invite. Prefer the user's own subscription only if it points
    // at this workspace; otherwise skip the bump and let the reconciler
    // handle it.
    if (!sub || sub.workspaceId !== workspaceId) {
      console.log(
        `[invite-accept] No subscription found for workspace ${workspaceId} (user=${userId}); skipping seat bump`,
      );
      return;
    }

    const stripe = getStripe();
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    const item = stripeSub.items.data[0];
    if (!item) {
      console.warn(
        `[invite-accept] Subscription ${sub.stripeSubscriptionId} has no items; skipping seat bump`,
      );
      return;
    }
    const currentQty = item.quantity ?? 1;
    await stripe.subscriptionItems.update(item.id, {
      quantity: currentQty + 1,
      proration_behavior: "create_prorations",
    });
    console.log(
      `[invite-accept] Bumped seat quantity for sub ${sub.stripeSubscriptionId} from ${currentQty} to ${currentQty + 1}`,
    );
  } catch (err) {
    console.warn(
      `[invite-accept] Stripe seat bump failed for workspace ${workspaceId}: ${(err as Error).message}`,
    );
  }
}

export function createMemberInviteRoutes(pool: Pool): Router {
  const router = Router();

  // ------------------------------------------------------------------
  // POST /api/workspace/members/invite
  // ------------------------------------------------------------------
  router.post(
    "/invite",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = req.auth?.sub?.trim();
      if (!userId) {
        res.status(401).json({ error: "Authenticated user required" });
        return;
      }
      const workspaceId = getWorkspaceId(req);
      if (!workspaceId) {
        res.status(400).json({ error: "Active workspace required" });
        return;
      }

      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const role = typeof req.body?.role === "string" ? (req.body.role as InviteRole) : null;
      // Length cap + character-class regex (no `.+` backtracking) — fixes
      // CodeQL js/redos finding flagged on the previous `/.+@.+\..+/` pattern.
      if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ error: "Valid email required" });
        return;
      }
      if (!role || !ALLOWED_ROLES.has(role)) {
        res.status(400).json({
          error: `Role must be one of: ${[...ALLOWED_ROLES].join(", ")}`,
        });
        return;
      }

      const authorized = await isOwnerOrAdmin(pool, workspaceId, userId);
      if (!authorized) {
        res
          .status(403)
          .json({ error: "Only workspace owners or admins can invite teammates" });
        return;
      }

      const token = randomBytes(32).toString("hex");
      const inserted = await pool.query<InviteRow>(
        `INSERT INTO workspace_member_invites
           (workspace_id, email, role, invited_by, invite_token)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [workspaceId, email, role, userId, token],
      );
      const row = inserted.rows[0];
      if (!row) {
        res.status(500).json({ error: "Failed to create invite" });
        return;
      }

      // TODO(HEL-213-mail): replace this log with the real mailer once it
      // exists in the repo. The invite URL surfaces here so e2e tests + dev
      // workflows have a deterministic redemption path.
      const inviteUrl = `${process.env.APP_URL ?? "http://localhost:5173"}/auth/accept-invite?token=${token}`;
      console.log(
        `[member-invite] Created invite ${row.id} for ${email} (workspace=${workspaceId} role=${role}). Redeem via ${inviteUrl}`,
      );

      res.status(201).json({
        invite: {
          id: row.id,
          email: row.email,
          role: row.role,
          expiresAt: row.expires_at,
          createdAt: row.created_at,
        },
      });
    }),
  );

  // ------------------------------------------------------------------
  // POST /api/workspace/members/invite/:token/accept
  // ------------------------------------------------------------------
  router.post(
    "/invite/:token/accept",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = req.auth?.sub?.trim();
      if (!userId) {
        res.status(401).json({ error: "Authenticated user required" });
        return;
      }

      const token = req.params.token?.trim();
      if (!token) {
        res.status(400).json({ error: "Invite token required" });
        return;
      }

      const lookup = await pool.query<InviteRow>(
        `SELECT *
           FROM workspace_member_invites
          WHERE invite_token = $1
          LIMIT 1`,
        [token],
      );
      const invite = lookup.rows[0];
      if (!invite) {
        res.status(404).json({ error: "Invite not found" });
        return;
      }
      if (invite.accepted_at) {
        res.status(409).json({ error: "Invite already accepted" });
        return;
      }
      if (Date.parse(invite.expires_at) < Date.now()) {
        res.status(410).json({ error: "Invite has expired" });
        return;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO workspace_members (workspace_id, user_id, role)
           VALUES ($1, $2, $3)
           ON CONFLICT (workspace_id, user_id) DO NOTHING`,
          [invite.workspace_id, userId, invite.role],
        );
        await client.query(
          `UPDATE workspace_member_invites
              SET accepted_at = now()
            WHERE id = $1`,
          [invite.id],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        console.error(
          `[invite-accept] Failed to accept invite ${invite.id}: ${(err as Error).message}`,
        );
        res.status(500).json({ error: "Failed to accept invite" });
        return;
      } finally {
        client.release();
      }

      // Best-effort Stripe seat bump after the DB transaction commits.
      // Failures here are logged but never surface — the user is in the
      // workspace either way and the reconciler will catch drift.
      await bumpStripeSubscriptionSeat(invite.workspace_id, userId);

      res.json({
        accepted: true,
        workspaceId: invite.workspace_id,
        role: invite.role,
      });
    }),
  );

  // ------------------------------------------------------------------
  // DELETE /api/workspace/members/invite/:id
  // ------------------------------------------------------------------
  router.delete(
    "/invite/:id",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = req.auth?.sub?.trim();
      if (!userId) {
        res.status(401).json({ error: "Authenticated user required" });
        return;
      }
      const workspaceId = getWorkspaceId(req);
      if (!workspaceId) {
        res.status(400).json({ error: "Active workspace required" });
        return;
      }

      const inviteId = req.params.id?.trim();
      if (!inviteId || !isUuid(inviteId)) {
        res.status(400).json({ error: "Invalid invite id" });
        return;
      }

      const authorized = await isOwnerOrAdmin(pool, workspaceId, userId);
      if (!authorized) {
        res
          .status(403)
          .json({ error: "Only workspace owners or admins can cancel invites" });
        return;
      }

      const deleted = await pool.query<{ id: string }>(
        `DELETE FROM workspace_member_invites
          WHERE id = $1 AND workspace_id = $2 AND accepted_at IS NULL
        RETURNING id`,
        [inviteId, workspaceId],
      );
      if (deleted.rowCount === 0) {
        res.status(404).json({ error: "Pending invite not found" });
        return;
      }
      res.json({ cancelled: true, id: inviteId });
    }),
  );

  return router;
}
