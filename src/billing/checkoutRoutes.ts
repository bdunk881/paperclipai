/**
 * Checkout session API routes.
 * Creates Stripe Checkout sessions for subscription purchases.
 */

import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { asyncHandler } from "../middleware/asyncHandler";
import { getStripe, resolveStripePriceId } from "./stripeClient";
import { getTierById } from "./tiersRepository";

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
 * Body: { tier: "flow"|"automate"|"scale", email?, firstName?, companyName?, workspaceId? }
 * Returns: { url: string } — Stripe hosted checkout URL
 */
router.post(
  "/",
  asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const { tier, email, firstName, companyName } = req.body as {
      tier?: string;
      email?: string;
      firstName?: string;
      companyName?: string;
    };
    // SECURITY: route is requireAuth-mounted (src/app.ts). Trust ONLY the
    // JWT-resolved identity for both userId and workspaceId. Body / header
    // fallbacks would let any caller knowing a victim's workspace UUID overwrite
    // that tenant's entitlement row at webhook time
    // (handleCheckoutSessionCompleted writes by workspace_id with ON CONFLICT).
    const resolvedUserId = req.auth?.sub;
    const resolvedWorkspaceId = req.auth?.workspaceId;

    if (!tier) {
      res.status(400).json({ error: "Invalid tier" });
      return;
    }

    const tierRow = await getTierById(tier);
    if (!tierRow || !tierRow.enabled) {
      res.status(400).json({ error: "Invalid tier" });
      return;
    }

    if (tierRow.priceUsdCents === 0) {
      res.status(400).json({ error: `${tierRow.displayName} is a free tier — no checkout required` });
      return;
    }

    const priceId = resolveStripePriceId(tierRow.stripePriceEnv);
    if (!priceId) {
      res.status(503).json({ error: "Stripe pricing not configured for this tier" });
      return;
    }

    try {
      const stripe = getStripe();
      const appBaseUrl = resolveAppBaseUrl(req);

      const metadata = {
        tier,
        ...(email ? { email } : {}),
        ...(firstName ? { firstName } : {}),
        ...(companyName ? { companyName } : {}),
        ...(resolvedUserId ? { userId: resolvedUserId } : {}),
        ...(resolvedWorkspaceId ? { workspaceId: resolvedWorkspaceId } : {}),
      };

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${appBaseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appBaseUrl}/pricing`,
        allow_promotion_codes: true,
        metadata,
      };

      if (tierRow.trialDays > 0) {
        sessionParams.subscription_data = {
          trial_period_days: tierRow.trialDays,
          metadata,
        };
      } else {
        sessionParams.subscription_data = { metadata };
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
  }),
);

export default router;
