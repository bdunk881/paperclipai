/**
 * Billing admin routes — refunds, comp credits, plan changes, invoice ops.
 *
 * Wraps the existing Stripe client. Caps and approvals:
 *   - Refunds > $100 require a second-admin confirmation via pending_admin_actions
 *     (TODO when needed — v1 hard-caps at $100 without approval)
 *   - Comp credits > ADMIN_CREDIT_APPROVAL_THRESHOLD_CENTS need manager approval
 *
 * Mounted under /api/admin-console/billing.
 */

import { Router } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../middleware/asyncHandler";
import { recordAdminAction } from "./auditLog";
import { consumeRateLimit } from "./rateLimit";
import { extractAuditContext, type PlatformAdminRequest } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REFUND_CENTS_WITHOUT_APPROVAL = 10_000;

interface StripeFacade {
  refundCharge(args: {
    chargeId: string;
    amountCents?: number;
    reason: string;
  }): Promise<{ id: string; amount: number; status: string }>;
  cancelSubscription(args: {
    subscriptionId: string;
    cancelAtPeriodEnd: boolean;
  }): Promise<{ id: string; status: string }>;
}

export interface BillingRouteDeps {
  stripe?: StripeFacade;
}

/**
 * Default Stripe facade. Pulls the existing Stripe client from src/billing
 * and adapts it. If Stripe is not configured the routes return 503.
 */
async function getDefaultStripeFacade(): Promise<StripeFacade | null> {
  // Late-load so unit tests can run without STRIPE_SECRET_KEY in env.
  const mod = await import("../billing/stripeClient");
  const client = (mod as { getStripeClient?: () => unknown }).getStripeClient?.();
  if (!client) return null;
  type StripeApi = {
    refunds: { create: (args: Record<string, unknown>) => Promise<{ id: string; amount: number; status: string }> };
    subscriptions: {
      update: (
        id: string,
        args: Record<string, unknown>,
      ) => Promise<{ id: string; status: string }>;
      cancel: (id: string) => Promise<{ id: string; status: string }>;
    };
  };
  const stripe = client as StripeApi;
  return {
    async refundCharge(args) {
      const refund = await stripe.refunds.create({
        charge: args.chargeId,
        amount: args.amountCents,
        reason: "requested_by_customer",
        metadata: { admin_reason: args.reason },
      });
      return refund;
    },
    async cancelSubscription(args) {
      if (args.cancelAtPeriodEnd) {
        return stripe.subscriptions.update(args.subscriptionId, { cancel_at_period_end: true });
      }
      return stripe.subscriptions.cancel(args.subscriptionId);
    },
  };
}

export function createBillingRoutes(_pool: Pool, deps: BillingRouteDeps = {}): Router {
  const router = Router();

  // POST /refund — issue a refund.
  router.post(
    "/refund",
    asyncHandler(async (req, res) => {
      const chargeId = String(req.body?.charge_id ?? "").trim();
      const amountCents = req.body?.amount_cents != null ? Number(req.body.amount_cents) : undefined;
      const reason = String(req.body?.reason ?? "").trim();
      const targetUserId = req.body?.target_user_id ? String(req.body.target_user_id).trim() : null;
      const targetWorkspaceId = req.body?.target_workspace_id
        ? String(req.body.target_workspace_id).trim()
        : null;

      if (!chargeId.startsWith("ch_") && !chargeId.startsWith("py_")) {
        return res.status(400).json({ error: "invalid charge id" });
      }
      if (!reason) return res.status(400).json({ error: "reason required" });
      if (amountCents != null && (!Number.isInteger(amountCents) || amountCents <= 0)) {
        return res.status(400).json({ error: "amount_cents must be positive integer" });
      }
      if (amountCents != null && amountCents > MAX_REFUND_CENTS_WITHOUT_APPROVAL) {
        return res.status(403).json({
          error: `refunds > $${MAX_REFUND_CENTS_WITHOUT_APPROVAL / 100} require second-admin approval (not yet implemented in v1)`,
        });
      }
      if (targetWorkspaceId && !UUID_RE.test(targetWorkspaceId)) {
        return res.status(400).json({ error: "invalid workspace id" });
      }

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      consumeRateLimit(admin, "refunds");

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "issue_refund",
        targetUserId,
        targetWorkspaceId,
        reason,
        payload: { charge_id: chargeId, amount_cents: amountCents ?? null },
        context: extractAuditContext(req),
      });

      const stripe = deps.stripe ?? (await getDefaultStripeFacade());
      if (!stripe) return res.status(503).json({ error: "Stripe not configured" });

      const refund = await stripe.refundCharge({ chargeId, amountCents, reason });
      return res.json({ refund });
    }),
  );

  // POST /subscription/:subscriptionId/cancel
  router.post(
    "/subscription/:subscriptionId/cancel",
    asyncHandler(async (req, res) => {
      const subscriptionId = req.params.subscriptionId;
      if (!subscriptionId.startsWith("sub_")) {
        return res.status(400).json({ error: "invalid subscription id" });
      }
      const reason = String(req.body?.reason ?? "").trim();
      const cancelAtPeriodEnd = req.body?.cancel_at_period_end !== false;
      if (!reason) return res.status(400).json({ error: "reason required" });

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "change_plan",
        reason,
        payload: { subscription_id: subscriptionId, cancel_at_period_end: cancelAtPeriodEnd },
        context: extractAuditContext(req),
      });

      const stripe = deps.stripe ?? (await getDefaultStripeFacade());
      if (!stripe) return res.status(503).json({ error: "Stripe not configured" });

      const result = await stripe.cancelSubscription({ subscriptionId, cancelAtPeriodEnd });
      return res.json({ subscription: result });
    }),
  );

  return router;
}
