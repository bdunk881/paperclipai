/**
 * Wallet read endpoint. Dashboard hits this to display the current
 * balance / lifetime totals / auto-topup config in the billing panel.
 *
 * Also hosts the auto-topup setup endpoints (POST /setup-checkout to
 * collect a card via Stripe Checkout, PATCH /auto-topup to update the
 * threshold + amount + enabled flag).
 */
import { Router, Response } from "express";
import type Stripe from "stripe";

import type { AuthenticatedRequest } from "../../auth/authMiddleware";
import { asyncHandler } from "../../middleware/asyncHandler";
import { getStripe } from "../stripeClient";
import {
  getWalletBalance,
  getWalletStripeIds,
  setWalletStripeCustomerId,
  updateAutoTopupConfig,
} from "./walletStore";

function resolveAppBaseUrl(req: AuthenticatedRequest): string {
  const fromEnv = process.env.APP_BASE_URL?.trim();
  if (fromEnv) return fromEnv;
  const host = req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? req.protocol;
  return host ? `${proto}://${host}` : "http://localhost:5173";
}

const router = Router();

router.get(
  "/balance",
  asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const userId = req.auth?.sub;
    const workspaceId = req.auth?.workspaceId;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const wallet = await getWalletBalance(workspaceId, userId);
    if (!wallet) {
      // Lazy: a wallet doesn't exist until the first grant. Surface zero.
      res.json({
        balanceCredits: "0",
        lifetimePurchasedCredits: "0",
        lifetimeConsumedCredits: "0",
        autoTopupEnabled: false,
      });
      return;
    }

    res.json({
      balanceCredits: wallet.balanceCredits.toString(),
      lifetimePurchasedCredits: wallet.lifetimePurchasedCredits.toString(),
      lifetimeConsumedCredits: wallet.lifetimeConsumedCredits.toString(),
      autoTopupEnabled: wallet.autoTopupEnabled,
      autoTopupTriggerCredits: wallet.autoTopupTriggerCredits?.toString() ?? null,
      autoTopupAmountCredits: wallet.autoTopupAmountCredits?.toString() ?? null,
      updatedAt: wallet.updatedAt,
    });
  }),
);

/**
 * Start a Stripe Checkout session in mode='setup' to collect a card
 * for off-session auto-topup PaymentIntents. Reuses the existing
 * redirect-to-Stripe pattern from the credit pack flow so we don't
 * need @stripe/stripe-js + Elements in the dashboard.
 *
 * Flow:
 *  1. Dashboard POSTs here, gets back a Stripe Checkout URL.
 *  2. Redirects the customer to Stripe — they enter card details.
 *  3. Stripe redirects back to /billing/credits/auto-topup/success.
 *  4. setup_intent.succeeded webhook fires:
 *       a) Creates/updates the Stripe Customer (attached via
 *          `customer_creation: 'always'` on the checkout session)
 *       b) Saves customer_id + payment_method_id onto the wallet.
 *  5. Customer is now ready for the worker to fire top-ups.
 */
router.post(
  "/setup-checkout",
  asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const userId = req.auth?.sub;
    const workspaceId = req.auth?.workspaceId;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const stripe = getStripe();
    const appBaseUrl = resolveAppBaseUrl(req);

    const existing = await getWalletStripeIds(workspaceId);
    const metadata: Record<string, string> = {
      kind: "credits_auto_topup_setup",
      workspaceId,
      userId,
    };

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "setup",
      payment_method_types: ["card"],
      success_url: `${appBaseUrl}/billing/credits/auto-topup/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appBaseUrl}/billing`,
      metadata,
      setup_intent_data: { metadata },
    };

    // Reuse the customer if we already have one; otherwise let Stripe
    // create one and we'll capture the id from the setup_intent.succeeded
    // webhook.
    if (existing.stripeCustomerId) {
      sessionParams.customer = existing.stripeCustomerId;
    } else {
      sessionParams.customer_creation = "always";
    }

    try {
      const session = await stripe.checkout.sessions.create(sessionParams);
      if (!session.url) {
        res.status(502).json({ error: "Stripe did not return a checkout URL" });
        return;
      }
      res.json({ url: session.url });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[credits/wallet/setup-checkout] Stripe error for workspace ${workspaceId}: ${message}`);
      res.status(502).json({ error: "Failed to create setup checkout session" });
    }
  }),
);

/**
 * Confirm a setup-checkout session immediately after Stripe redirects
 * back. Mirrors the credit pack confirm endpoint — the webhook also
 * processes setup_intent.succeeded, so this is a faster-feedback hop
 * that's safe to retry (the webhook dedupes by stripe_customer_id +
 * stripe_payment_method_id).
 */
router.post(
  "/setup-checkout/confirm",
  asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const userId = req.auth?.sub;
    const workspaceId = req.auth?.workspaceId;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : null;
    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    const stripe = getStripe();
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["setup_intent"],
      });
      const meta = (session.metadata ?? {}) as Record<string, string>;
      if (meta.kind !== "credits_auto_topup_setup") {
        res.status(400).json({ error: "Session is not an auto-topup setup" });
        return;
      }
      if (meta.workspaceId !== workspaceId) {
        res.status(403).json({ error: "Session belongs to a different workspace" });
        return;
      }

      const setupIntent = session.setup_intent as Stripe.SetupIntent | string | null;
      const setupIntentObject =
        typeof setupIntent === "string"
          ? await stripe.setupIntents.retrieve(setupIntent)
          : setupIntent;
      if (!setupIntentObject) {
        res.status(404).json({ error: "Setup intent missing on session" });
        return;
      }
      if (setupIntentObject.status !== "succeeded") {
        res.status(409).json({
          error: `Setup not yet complete (status=${setupIntentObject.status})`,
        });
        return;
      }

      const stripeCustomerId =
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id;
      const paymentMethodId =
        typeof setupIntentObject.payment_method === "string"
          ? setupIntentObject.payment_method
          : setupIntentObject.payment_method?.id;

      if (!stripeCustomerId || !paymentMethodId) {
        res.status(502).json({
          error: "Stripe session missing customer_id or payment_method_id",
        });
        return;
      }

      // The webhook also runs this — idempotent by design.
      const { setWalletStripePaymentMethodId } = await import("./walletStore");
      await setWalletStripeCustomerId(workspaceId, stripeCustomerId);
      await setWalletStripePaymentMethodId(workspaceId, paymentMethodId);

      res.json({
        ok: true,
        stripeCustomerId,
        paymentMethodId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[credits/wallet/setup-checkout/confirm] error for workspace ${workspaceId}: ${message}`,
      );
      res.status(502).json({ error: "Failed to confirm setup checkout session" });
    }
  }),
);

/**
 * Update auto-topup config. Accepts:
 *   - `enabled` (bool, required)
 *   - `triggerCredits` (string|number, required when enabled=true) — top up
 *      when balance drops below this many credits.
 *   - `amountCredits` (string|number, required when enabled=true) — how
 *      many credits to top up per cycle.
 *
 * Server-side guard rails:
 *   - triggerCredits >= 1,000 (so we don't trigger on every-cent fluctuation)
 *   - amountCredits  >= 10,000 (avoid pennies-per-top-up dust)
 *   - amountCredits  <= 10,000,000 (1M credits = $100 max per cycle, avoid
 *     surprise large auto-charges)
 */
router.patch(
  "/auto-topup",
  asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const workspaceId = req.auth?.workspaceId;
    if (!workspaceId) {
      res.status(401).json({ error: "Authenticated workspace required" });
      return;
    }

    const body = req.body as {
      enabled?: unknown;
      triggerCredits?: unknown;
      amountCredits?: unknown;
    };
    if (typeof body.enabled !== "boolean") {
      res.status(400).json({ error: "enabled (boolean) is required" });
      return;
    }

    let triggerCredits: bigint | null = null;
    let amountCredits: bigint | null = null;
    if (body.enabled) {
      try {
        triggerCredits = BigInt(String(body.triggerCredits ?? ""));
        amountCredits = BigInt(String(body.amountCredits ?? ""));
      } catch {
        res.status(400).json({
          error: "triggerCredits and amountCredits must be integers when enabled=true",
        });
        return;
      }
      if (triggerCredits < 1000n) {
        res.status(400).json({
          error: "triggerCredits must be >= 1000 to avoid noisy auto-charges",
        });
        return;
      }
      if (amountCredits < 10000n || amountCredits > 10_000_000n) {
        res.status(400).json({
          error: "amountCredits must be between 10,000 and 10,000,000 (max $1000/cycle)",
        });
        return;
      }
    }

    await updateAutoTopupConfig(workspaceId, {
      enabled: body.enabled,
      triggerCredits,
      amountCredits,
    });

    res.json({
      ok: true,
      enabled: body.enabled,
      triggerCredits: triggerCredits?.toString() ?? null,
      amountCredits: amountCredits?.toString() ?? null,
    });
  }),
);

export default router;
