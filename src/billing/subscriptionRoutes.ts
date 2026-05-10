/**
 * Subscription lifecycle API routes.
 * Handles upgrade/downgrade, cancellation, and status queries.
 */

import { Router, Request, Response } from "express";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { recordControlPlaneAudit } from "../auditing/controlPlaneAudit";
import { getStripe, PRICING_TIERS, TierKey } from "./stripeClient";
import { subscriptionStore, resolveTier } from "./subscriptionStore";
import { billingRepository, effectiveEntitlementPlan } from "./billingRepository";
import { entitlementStore } from "./entitlements";

const router = Router();

function getWorkspaceId(req: Request): string | undefined {
  // SECURITY: trust ONLY the JWT-resolved workspace. Header / body fallbacks
  // here would let an authenticated user pass another tenant's UUID and cause
  // cross-tenant subscription/entitlement writes via syncSubscriptionWorkspaceState
  // (no workspace-membership validation gates the persist path). Pre-migration
  // subscriptions without a stored workspaceId remain accessible read-only,
  // and write ops on them now require the JWT to carry the matching workspace.
  return (req as AuthenticatedRequest).auth?.workspaceId?.trim() || undefined;
}

async function syncSubscriptionWorkspaceState(req: Request, subId: string): Promise<void> {
  const sub = subscriptionStore.get(subId);
  if (!sub?.workspaceId) {
    return;
  }

  // DB persist first, then in-memory cache. Reversing this order risked the
  // in-memory entitlement diverging from durable state if the DB write
  // failed (Sentry P2 review on PR #650).
  await billingRepository.upsertSubscriptionAndEntitlements({
    workspaceId: sub.workspaceId,
    userId: sub.userId,
    stripeSubscriptionId: sub.stripeSubscriptionId,
    stripeCustomerId: sub.stripeCustomerId,
    plan: sub.tier,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
  });
  entitlementStore.upsert(sub.workspaceId, effectiveEntitlementPlan(sub.tier, sub.status));

  if (sub.userId) {
    await recordControlPlaneAudit({
      workspaceId: sub.workspaceId,
      userId: sub.userId,
      category: "billing",
      action: "subscription_mutated",
      target: { type: "subscription", id: sub.stripeSubscriptionId },
      metadata: {
        method: req.method,
        path: req.originalUrl || req.path,
        plan: sub.tier,
        status: sub.status,
      },
    });
  }
}

/**
 * GET /api/billing/subscription
 * Returns the user's current subscription status.
 */
router.get("/", (req: AuthenticatedRequest, res: Response) => {
  const userId = req.auth?.sub;
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const sub = subscriptionStore.getByUserId(userId);
  if (!sub) {
    res.json({ subscription: null, accessLevel: "none" });
    return;
  }

  res.json({
    subscription: {
      id: sub.id,
      tier: sub.tier,
      status: sub.status,
      accessLevel: sub.accessLevel,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      trialEnd: sub.trialEnd,
    },
    accessLevel: sub.accessLevel,
  });
});

/**
 * POST /api/billing/subscription/change-tier
 * Body: { newTier: "flow"|"automate"|"scale" }
 * Upgrades or downgrades the subscription by swapping the Stripe price.
 */
router.post("/change-tier", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.auth?.sub;
  const { newTier } = req.body as { newTier?: string };

  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }
  if (!newTier || !(newTier in PRICING_TIERS)) {
    res.status(400).json({ error: `Invalid tier. Must be one of: ${Object.keys(PRICING_TIERS).join(", ")}` });
    return;
  }

  const sub = subscriptionStore.getByUserId(userId);
  if (!sub) {
    res.status(404).json({ error: "No active subscription found" });
    return;
  }

  if (sub.tier === newTier) {
    res.status(400).json({ error: `Already on the ${newTier} tier` });
    return;
  }

  if (newTier === "explore") {
    res.status(400).json({ error: "Cannot change to the free Explore tier — cancel instead" });
    return;
  }

  const newPriceId = PRICING_TIERS[newTier as TierKey].priceId;
  if (!newPriceId) {
    res.status(503).json({ error: "Stripe pricing not configured for this tier" });
    return;
  }

  try {
    const stripe = getStripe();
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    const itemId = stripeSub.items.data[0]?.id;

    if (!itemId) {
      res.status(500).json({ error: "Could not find subscription item to update" });
      return;
    }

    // Determine proration behavior: upgrade prorates immediately, downgrade at period end
    const currentPrice = PRICING_TIERS[sub.tier]?.price ?? 0;
    const newPrice = PRICING_TIERS[newTier as TierKey].price;
    const isUpgrade = newPrice > currentPrice;

    const updated = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      items: [{ id: itemId, price: newPriceId }],
      proration_behavior: isUpgrade ? "create_prorations" : "none",
      metadata: { ...stripeSub.metadata, tier: newTier },
    });

    const workspaceId = sub.workspaceId ?? getWorkspaceId(req);
    const stored = subscriptionStore.update(sub.id, {
      workspaceId,
      tier: newTier as TierKey,
      status: updated.status,
    });
    if (stored) {
      await syncSubscriptionWorkspaceState(req, stored.id);
    }

    console.log(`[stripe/subscription] ${isUpgrade ? "Upgraded" : "Downgraded"} ${userId} from ${sub.tier} to ${newTier}`);
    res.json({
      success: true,
      previousTier: sub.tier,
      newTier,
      proration: isUpgrade ? "immediate" : "none",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stripe/subscription] Tier change failed: ${msg}`);
    res.status(500).json({ error: "Failed to change subscription tier" });
  }
});

/**
 * POST /api/billing/subscription/cancel
 * Body: {}
 * Cancels the subscription at end of current billing period.
 */
router.post("/cancel", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.auth?.sub;
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const sub = subscriptionStore.getByUserId(userId);
  if (!sub) {
    res.status(404).json({ error: "No active subscription found" });
    return;
  }

  if (sub.accessLevel === "cancelled") {
    res.status(400).json({ error: "Subscription is already cancelled" });
    return;
  }

  try {
    const stripe = getStripe();
    const updated = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    const workspaceId = sub.workspaceId ?? getWorkspaceId(req);
    const stored = subscriptionStore.update(sub.id, {
      workspaceId,
      cancelAtPeriodEnd: true,
      status: updated.status,
    });
    if (stored) {
      await syncSubscriptionWorkspaceState(req, stored.id);
    }

    console.log(`[stripe/subscription] Cancellation scheduled for ${userId} at period end (${sub.currentPeriodEnd})`);
    res.json({
      success: true,
      cancelAtPeriodEnd: true,
      accessUntil: sub.currentPeriodEnd,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stripe/subscription] Cancellation failed: ${msg}`);
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
});

/**
 * POST /api/billing/subscription/reactivate
 * Body: {}
 * Reactivates a subscription that was scheduled for cancellation.
 */
router.post("/reactivate", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.auth?.sub;
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const sub = subscriptionStore.getByUserId(userId);
  if (!sub) {
    res.status(404).json({ error: "No active subscription found" });
    return;
  }

  if (!sub.cancelAtPeriodEnd) {
    res.status(400).json({ error: "Subscription is not scheduled for cancellation" });
    return;
  }

  try {
    const stripe = getStripe();
    const updated = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    const workspaceId = sub.workspaceId ?? getWorkspaceId(req);
    const stored = subscriptionStore.update(sub.id, {
      workspaceId,
      cancelAtPeriodEnd: false,
      status: updated.status,
    });
    if (stored) {
      await syncSubscriptionWorkspaceState(req, stored.id);
    }

    console.log(`[stripe/subscription] Reactivated subscription for ${userId}`);
    res.json({ success: true, cancelAtPeriodEnd: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stripe/subscription] Reactivation failed: ${msg}`);
    res.status(500).json({ error: "Failed to reactivate subscription" });
  }
});

export default router;
