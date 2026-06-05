/**
 * Read-only billing info + Stripe billing-portal session (HEL-402).
 *
 * The /billing page fetches `GET /api/billing/payment-method` and
 * `GET /api/billing/next-invoice` (previously never mounted → both panels
 * degraded to empty), and the "Update card" button opens the Stripe billing
 * portal via `POST /api/billing/portal-session`.
 *
 * The Stripe customer is resolved from the user's subscription record, so a
 * user without a Stripe customer gets a graceful `{ paymentMethod: null }` /
 * `{ invoice: null }` (which the FE already renders as the empty state) rather
 * than an error.
 */

import { Router, Response } from "express";
import type Stripe from "stripe";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { getStripe } from "./stripeClient";
import { subscriptionStore } from "./subscriptionStore";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();

async function resolveStripeCustomerId(userId: string): Promise<string | null> {
  const sub = await subscriptionStore.getByUserId(userId);
  return sub?.stripeCustomerId?.trim() || null;
}

function resolveReturnUrl(): string {
  const origin = (process.env.DASHBOARD_ORIGIN ?? "https://app.helloautoflow.com")
    .trim()
    .replace(/\/$/, "");
  return `${origin}/billing`;
}

/** GET /api/billing/payment-method → { paymentMethod: {brand,last4,expMonth,expYear} | null } */
router.get(
  "/payment-method",
  asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const userId = req.auth?.sub;
    if (!userId) {
      res.status(401).json({ error: "Authenticated user is required" });
      return;
    }

    const customerId = await resolveStripeCustomerId(userId);
    if (!customerId) {
      res.json({ paymentMethod: null });
      return;
    }

    try {
      const stripe = getStripe();
      const customer = await stripe.customers.retrieve(customerId, {
        expand: ["invoice_settings.default_payment_method"],
      });
      if ("deleted" in customer && customer.deleted) {
        res.json({ paymentMethod: null });
        return;
      }

      // Prefer the customer's default PM; fall back to the first card on file.
      const defaultPm = customer.invoice_settings?.default_payment_method;
      let card: Stripe.PaymentMethod.Card | null =
        defaultPm && typeof defaultPm === "object" ? defaultPm.card ?? null : null;

      if (!card) {
        const list = await stripe.paymentMethods.list({
          customer: customerId,
          type: "card",
          limit: 1,
        });
        card = list.data[0]?.card ?? null;
      }

      if (!card) {
        res.json({ paymentMethod: null });
        return;
      }

      res.json({
        paymentMethod: {
          brand: card.brand,
          last4: card.last4,
          expMonth: card.exp_month,
          expYear: card.exp_year,
        },
      });
    } catch (err) {
      console.error(`[stripe/billing] payment-method lookup failed: ${(err as Error).message}`);
      res.status(502).json({ error: "Failed to load payment method" });
    }
  }),
);

/** GET /api/billing/next-invoice → { invoice: {amountDue,currency,periodEnd} | null } */
router.get(
  "/next-invoice",
  asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const userId = req.auth?.sub;
    if (!userId) {
      res.status(401).json({ error: "Authenticated user is required" });
      return;
    }

    const customerId = await resolveStripeCustomerId(userId);
    if (!customerId) {
      res.json({ invoice: null });
      return;
    }

    try {
      const stripe = getStripe();
      // Stripe v21 replaced invoices.retrieveUpcoming() with createPreview().
      const upcoming = await stripe.invoices.createPreview({ customer: customerId });
      res.json({
        invoice: {
          amountDue: upcoming.amount_due,
          currency: upcoming.currency,
          periodEnd: new Date(upcoming.period_end * 1000).toISOString(),
        },
      });
    } catch (err) {
      // No upcoming invoice (no active subscription / nothing to bill) is a
      // normal "empty" state for the panel, not an error.
      const code = (err as { code?: string }).code;
      if (code === "invoice_upcoming_none" || code === "resource_missing") {
        res.json({ invoice: null });
        return;
      }
      console.error(`[stripe/billing] next-invoice lookup failed: ${(err as Error).message}`);
      res.status(502).json({ error: "Failed to load next invoice" });
    }
  }),
);

/**
 * POST /api/billing/portal-session → { url }
 * Creates a Stripe billing-portal session so the member can update their card
 * (and manage payment methods / invoices). The portal itself is Stripe-hosted
 * and is the security boundary for the actual card change.
 */
router.post(
  "/portal-session",
  asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const userId = req.auth?.sub;
    if (!userId) {
      res.status(401).json({ error: "Authenticated user is required" });
      return;
    }

    const customerId = await resolveStripeCustomerId(userId);
    if (!customerId) {
      res.status(404).json({ error: "No billing customer on file" });
      return;
    }

    try {
      const stripe = getStripe();
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: resolveReturnUrl(),
      });
      res.json({ url: session.url });
    } catch (err) {
      console.error(`[stripe/billing] portal session failed: ${(err as Error).message}`);
      res.status(502).json({ error: "Failed to open billing portal" });
    }
  }),
);

export default router;
