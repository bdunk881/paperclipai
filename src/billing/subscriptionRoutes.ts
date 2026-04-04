/**
 * Subscription lifecycle API routes.
 * Handles upgrade/downgrade, cancellation, and status queries.
 */

import { Router, Request, Response } from "express";
import { getStripe, PRICING_TIERS, TierKey } from "./stripeClient";
import { subscriptionStore, resolveTier } from "./subscriptionStore";

const router = Router();

/**
 * GET /api/billing/subscription?userId=:userId
 * Returns the user's current subscription status.
 */
router.get("/", (req: Request, res: Response) => {
  const userId = (req.query.userId as string) ?? (req.headers["x-user-id"] as string);
  if (!userId) {
    res.status(400).json({ error: "userId query param or X-User-Id header is required" });
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
 * Body: { userId: string, newTier: "starter"|"growth"|"scale" }
 * Upgrades or downgrades the subscription by swapping the Stripe price.
 */
router.post("/change-tier", async (req: Request, res: Response) => {
  const { userId, newTier } = req.body as { userId?: string; newTier?: string };

  if (!userId) {
    res.status(400).json({ error: "userId is required" });
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

    subscriptionStore.update(sub.id, {
      tier: newTier as TierKey,
      status: updated.status,
    });

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
 * Body: { userId: string }
 * Cancels the subscription at end of current billing period.
 */
router.post("/cancel", async (req: Request, res: Response) => {
  const { userId } = req.body as { userId?: string };

  if (!userId) {
    res.status(400).json({ error: "userId is required" });
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

    subscriptionStore.update(sub.id, {
      cancelAtPeriodEnd: true,
      status: updated.status,
    });

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
 * Body: { userId: string }
 * Reactivates a subscription that was scheduled for cancellation.
 */
router.post("/reactivate", async (req: Request, res: Response) => {
  const { userId } = req.body as { userId?: string };

  if (!userId) {
    res.status(400).json({ error: "userId is required" });
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

    subscriptionStore.update(sub.id, {
      cancelAtPeriodEnd: false,
      status: updated.status,
    });

    console.log(`[stripe/subscription] Reactivated subscription for ${userId}`);
    res.json({ success: true, cancelAtPeriodEnd: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stripe/subscription] Reactivation failed: ${msg}`);
    res.status(500).json({ error: "Failed to reactivate subscription" });
  }
});

export default router;
