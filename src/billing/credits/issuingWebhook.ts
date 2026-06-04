/**
 * Stripe Issuing webhook (HEL-599) — the real-time spend-control endpoint for
 * the direct-provider virtual cards.
 *
 *   POST /api/webhooks/stripe/issuing
 *
 * This is a SEPARATE endpoint from the main Stripe webhook
 * (src/billing/stripeWebhook.ts) with its OWN signing secret
 * (STRIPE_ISSUING_WEBHOOK_SECRET), so the latency-critical authorization path
 * is isolated and can be pointed at a distinct Stripe webhook endpoint.
 *
 * Handled events:
 *   - issuing_authorization.request — Stripe asks us to approve/decline a
 *     provider card charge in real time (~2s budget). We decide + write the
 *     treasury ledger row via stripeIssuing.decideAuthorization.
 *   - issuing_transaction.created — record refunds back to the card for
 *     reconciliation (captures are already booked at authorization time).
 *
 * Must be mounted with express.raw() BEFORE express.json() so the raw body is
 * available for signature verification (see app.ts).
 */
import { Router, Request, Response } from "express";
import type Stripe from "stripe";

import { asyncHandler } from "../../middleware/asyncHandler";
import { getStripe } from "../stripeClient";
import {
  decideAuthorization,
  type AuthorizationRequest,
} from "./stripeIssuing";
import { insertTreasuryLedgerRow } from "./treasuryLedgerStore";

const router = Router();

function cardIdOf(card: Stripe.Issuing.Authorization["card"] | Stripe.Issuing.Transaction["card"]): string {
  return typeof card === "string" ? card : card?.id ?? "";
}

router.post(
  "/",
  asyncHandler<Request>(async (req, res: Response) => {
    const webhookSecret = process.env.STRIPE_ISSUING_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("[stripe/issuing] STRIPE_ISSUING_WEBHOOK_SECRET not set");
      res.status(503).json({ error: "Issuing webhook not configured" });
      return;
    }

    const sig = req.headers["stripe-signature"] as string | undefined;
    if (!sig) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }

    let event: Stripe.Event;
    try {
      const stripe = getStripe();
      // req.body is a raw Buffer because app.ts mounts express.raw() here.
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[stripe/issuing] signature verification failed: ${msg}`);
      res.status(400).json({ error: "Webhook signature verification failed" });
      return;
    }

    try {
      await handleIssuingEvent(event, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[stripe/issuing] error handling ${event.type}: ${msg}`);
      // Don't leave Stripe hanging on the real-time auth path — a 200 lets
      // Stripe fall back to the card's spending_controls (our hard cap holds).
      if (!res.headersSent) {
        res.status(200).json({ received: true, handlerError: true });
      }
    }
  }),
);

async function handleIssuingEvent(event: Stripe.Event, res: Response): Promise<void> {
  switch (event.type) {
    case "issuing_authorization.request": {
      const auth = event.data.object as Stripe.Issuing.Authorization;
      const request: AuthorizationRequest = {
        id: auth.id,
        stripeCardId: cardIdOf(auth.card),
        // On a request, `pending_request` carries the amount up for approval.
        amountCents: auth.pending_request?.amount ?? auth.amount ?? 0,
        currency: auth.pending_request?.currency ?? auth.currency ?? "usd",
      };
      const decision = await decideAuthorization(request);
      res.status(200).json({ received: true, approved: decision.approved, reason: decision.reason });
      return;
    }

    case "issuing_transaction.created": {
      const txn = event.data.object as Stripe.Issuing.Transaction;
      // Captures of already-authorized charges are booked at authorization
      // time; only record refunds here (funds returning to the card).
      if (txn.type === "refund") {
        await insertTreasuryLedgerRow({
          provider: typeof txn.metadata?.autoflow_provider === "string"
            ? txn.metadata.autoflow_provider
            : "shared",
          type: "refund",
          // Refund transaction amounts are positive (funds returning).
          amountUsd: Number((Math.abs(txn.amount) / 100).toFixed(2)),
          stripeTransactionId: txn.id,
          stripeAuthorizationId: typeof txn.authorization === "string"
            ? txn.authorization
            : txn.authorization?.id ?? null,
          idempotencyKey: `issuing_txn__${txn.id}`,
          metadata: { transaction_type: txn.type, amount_cents: txn.amount },
        });
      }
      res.status(200).json({ received: true });
      return;
    }

    default:
      // Other issuing events (card.created, authorization.updated, etc.) are
      // acknowledged but not acted on in this phase.
      res.status(200).json({ received: true, ignored: event.type });
  }
}

export default router;
