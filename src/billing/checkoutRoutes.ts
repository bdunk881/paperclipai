/**
 * Checkout session API routes.
 * Creates Stripe Checkout sessions for subscription purchases.
 */

import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { getStripe, PRICING_TIERS, TierKey } from "./stripeClient";

const router = Router();

function resolveAppBaseUrl(req: Request): string {
  const configured = (process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? "").trim();
  if (configured) return configured.replace(/\/+$/, "");

  const origin = (req.get("origin") ?? "").trim();
  if (origin) return origin.replace(/\/+$/, "");

  // Local fallback keeps tests and local manual QA deterministic without extra env setup.
  return "http://localhost:3000";
}

/**
 * POST /api/billing/checkout
 * Body: { tier: "flow"|"automate"|"scale", email?, firstName?, companyName?, userId? }
 * Returns: { url: string } — Stripe hosted checkout URL
 */
router.post("/", async (req: Request, res: Response) => {
  const { tier, email, firstName, companyName, userId } = req.body as {
    tier?: string;
    email?: string;
    firstName?: string;
    companyName?: string;
    userId?: string;
  };

  if (!tier || !(tier in PRICING_TIERS)) {
    res.status(400).json({ error: `Invalid tier. Must be one of: ${Object.keys(PRICING_TIERS).join(", ")}` });
    return;
  }

  const tierConfig = PRICING_TIERS[tier as TierKey];

  if (tier === "explore") {
    res.status(400).json({ error: "Explore is a free tier — no checkout required" });
    return;
  }

  if (!tierConfig.priceId) {
    res.status(503).json({ error: "Stripe pricing not configured for this tier" });
    return;
  }

  try {
    const stripe = getStripe();
    const appBaseUrl = resolveAppBaseUrl(req);

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: tierConfig.priceId, quantity: 1 }],
      success_url: `${appBaseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appBaseUrl}/pricing`,
      allow_promotion_codes: true,
      metadata: {
        tier,
        ...(email ? { email } : {}),
        ...(firstName ? { firstName } : {}),
        ...(companyName ? { companyName } : {}),
        ...(userId ? { userId } : {}),
      },
    };

    // Add trial period for eligible tiers
    if (tierConfig.trialDays > 0) {
      sessionParams.subscription_data = {
        trial_period_days: tierConfig.trialDays,
      };
    }

    // Pre-fill email if provided
    if (email) {
      sessionParams.customer_email = email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stripe/checkout] Error creating session: ${msg}`);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

export default router;
