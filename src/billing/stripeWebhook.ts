/**
 * Stripe webhook handler for the Express backend.
 * Handles 8 critical subscription lifecycle events with signature verification.
 */

import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { getStripe } from "./stripeClient";
import { randomUUID } from "node:crypto";
import {
  subscriptionStore,
  mapStripeStatusToAccess,
  resolveTier,
  Subscription,
} from "./subscriptionStore";

const router = Router();

async function notifyCSM(params: {
  email: string;
  firstName: string;
  companyName: string;
  tier: string;
  signupDate: string;
  userId: string;
}): Promise<void> {
  const apiUrl = process.env.PAPERCLIP_API_URL;
  const apiKey = process.env.PAPERCLIP_WEBHOOK_API_KEY;
  const companyId = process.env.PAPERCLIP_COMPANY_ID;
  const csmAgentId = process.env.PAPERCLIP_CSM_AGENT_ID ?? "0cc5e90d-8514-40ea-b502-da0a585cd1df";
  const goalId = process.env.PAPERCLIP_ONBOARDING_GOAL_ID ?? "aa40b2bf-bf64-48a5-991d-0fcadd431a34";

  if (!apiUrl || !apiKey || !companyId) {
    console.warn("[paperclip] PAPERCLIP_WEBHOOK_API_KEY / PAPERCLIP_API_URL / PAPERCLIP_COMPANY_ID not set - skipping CSM task creation");
    return;
  }

  const title = `New ${params.tier} signup - ${params.email} · personal outreach within 24h`;
  const description = [
    "## New Paid User - CSM Outreach Required",
    "",
    `A new **${params.tier}** subscriber just completed checkout and needs a personal touch within **24 hours**.`,
    "",
    "| Field | Value |",
    "|-------|-------|",
    `| Email | ${params.email} |`,
    `| Name | ${params.firstName} |`,
    `| Company | ${params.companyName || "-"} |`,
    `| Tier | ${params.tier} |`,
    `| Signup date | ${params.signupDate} |`,
    `| User ID | ${params.userId || "-"} |`,
    "",
    "**Action:** Send a personal welcome email within 24h. Offer an onboarding call, ask about use-case goals, and flag any enterprise requirements.",
  ].join("\n");

  const response = await fetch(`${apiUrl}/api/companies/${companyId}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title,
      description,
      status: "todo",
      priority: "high",
      assigneeAgentId: csmAgentId,
      goalId,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`[paperclip] CSM task creation failed ${response.status}: ${body}`);
    return;
  }

  const task = await response.json() as { identifier?: string };
  console.log(`[paperclip] CSM task created: ${task.identifier}`);
}

// ---------------------------------------------------------------------------
// Webhook endpoint — receives raw body for signature verification
// ---------------------------------------------------------------------------

router.post("/", async (req: Request, res: Response) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[stripe/webhook] STRIPE_WEBHOOK_SECRET not set");
    res.status(503).json({ error: "Webhook not configured" });
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
    // req.body is a raw Buffer because we mount express.raw() for this route
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stripe/webhook] Signature verification failed: ${msg}`);
    res.status(400).json({ error: `Webhook signature verification failed` });
    return;
  }

  try {
    await handleEvent(event);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stripe/webhook] Error handling ${event.type}: ${msg}`);
    res.status(500).json({ error: "Webhook handler error" });
    return;
  }

  res.json({ received: true });
});

// ---------------------------------------------------------------------------
// Event dispatcher
// ---------------------------------------------------------------------------

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
    case "customer.subscription.created":
      return handleSubscriptionCreated(event.data.object as Stripe.Subscription);
    case "invoice.paid":
      return handleInvoicePaid(event.data.object as Stripe.Invoice);
    case "invoice.payment_failed":
      return handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
    case "customer.subscription.trial_will_end":
      return handleTrialWillEnd(event.data.object as Stripe.Subscription);
    case "customer.subscription.deleted":
      return handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
    case "customer.updated":
      return handleCustomerUpdated(event.data.object as Stripe.Customer);
    case "payment_intent.payment_failed":
      return handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
    default:
      console.log(`[stripe/webhook] Unhandled event type: ${event.type}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract subscription ID from an invoice (Stripe SDK v21 changed the shape). */
function getSubscriptionIdFromInvoice(invoice: Stripe.Invoice): string | undefined {
  const subDetails = invoice.parent?.subscription_details;
  if (!subDetails) return undefined;
  const sub = subDetails.subscription;
  return typeof sub === "string" ? sub : sub?.id;
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

/**
 * checkout.session.completed — provision subscription after successful checkout.
 * Creates the internal subscription record linking Stripe to our user model.
 */
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  if (session.mode !== "subscription") return;

  const meta = (session.metadata ?? {}) as Record<string, string>;
  const email = meta.email ?? session.customer_details?.email ?? session.customer_email ?? "";
  const userId = meta.userId ?? "";
  const stripeSubId = typeof session.subscription === "string"
    ? session.subscription
    : session.subscription?.id ?? "";

  if (!stripeSubId) {
    console.warn("[stripe/webhook] checkout.session.completed missing subscription ID");
    return;
  }

  // Fetch the full subscription to get period details
  const stripe = getStripe();
  const stripeSub = await stripe.subscriptions.retrieve(stripeSubId);
  const priceId = stripeSub.items.data[0]?.price?.id;
  const tier = resolveTier(meta, priceId);

  const existing = subscriptionStore.getByStripeSubscriptionId(stripeSubId);
  const now = new Date().toISOString();

  const sub: Subscription = {
    id: existing?.id ?? randomUUID(),
    stripeSubscriptionId: stripeSubId,
    stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? "",
    userId,
    email,
    tier,
    accessLevel: mapStripeStatusToAccess(stripeSub.status, stripeSub.cancel_at_period_end),
    status: stripeSub.status,
    currentPeriodStart: new Date(stripeSub.items.data[0]?.current_period_start ? stripeSub.items.data[0].current_period_start * 1000 : Date.now()).toISOString(),
    currentPeriodEnd: new Date(stripeSub.items.data[0]?.current_period_end ? stripeSub.items.data[0].current_period_end * 1000 : Date.now()).toISOString(),
    cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
    trialEnd: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000).toISOString() : null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  subscriptionStore.upsert(sub);
  console.log(`[stripe/webhook] checkout.session.completed — provisioned ${tier} subscription for ${email}`);

  if ((tier === "automate" || tier === "scale") && email) {
    const firstName = meta.firstName ?? session.customer_details?.name?.split(" ")[0] ?? "";
    const companyName = meta.companyName ?? "";
    const signupDate = new Date().toISOString();
    notifyCSM({ email, firstName, companyName, tier, signupDate, userId }).catch((error) => {
      console.error("[paperclip] notifyCSM error:", error);
    });
  }
}

/**
 * subscription.created — record new subscription.
 */
async function handleSubscriptionCreated(stripeSub: Stripe.Subscription): Promise<void> {
  const existing = subscriptionStore.getByStripeSubscriptionId(stripeSub.id);
  if (existing) {
    // Already provisioned via checkout.session.completed
    subscriptionStore.update(existing.id, {
      status: stripeSub.status,
      accessLevel: mapStripeStatusToAccess(stripeSub.status, stripeSub.cancel_at_period_end),
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
    });
    console.log(`[stripe/webhook] subscription.created — updated existing record for ${stripeSub.id}`);
    return;
  }

  const customerId = typeof stripeSub.customer === "string" ? stripeSub.customer : stripeSub.customer?.id ?? "";
  const priceId = stripeSub.items.data[0]?.price?.id;
  const meta = (stripeSub.metadata ?? {}) as Record<string, string>;
  const tier = resolveTier(meta, priceId);
  const now = new Date().toISOString();

  const sub: Subscription = {
    id: randomUUID(),
    stripeSubscriptionId: stripeSub.id,
    stripeCustomerId: customerId,
    userId: meta.userId ?? "",
    email: meta.email ?? "",
    tier,
    accessLevel: mapStripeStatusToAccess(stripeSub.status, stripeSub.cancel_at_period_end),
    status: stripeSub.status,
    currentPeriodStart: new Date(stripeSub.items.data[0]?.current_period_start ? stripeSub.items.data[0].current_period_start * 1000 : Date.now()).toISOString(),
    currentPeriodEnd: new Date(stripeSub.items.data[0]?.current_period_end ? stripeSub.items.data[0].current_period_end * 1000 : Date.now()).toISOString(),
    cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
    trialEnd: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000).toISOString() : null,
    createdAt: now,
    updatedAt: now,
  };

  subscriptionStore.upsert(sub);
  console.log(`[stripe/webhook] subscription.created — recorded new ${tier} subscription ${stripeSub.id}`);
}

/**
 * invoice.paid — confirm payment, extend access.
 */
async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const stripeSubId = getSubscriptionIdFromInvoice(invoice);
  if (!stripeSubId) return;

  const sub = subscriptionStore.getByStripeSubscriptionId(stripeSubId);
  if (!sub) {
    console.warn(`[stripe/webhook] invoice.paid — no subscription found for ${stripeSubId}`);
    return;
  }

  // Fetch updated subscription to get new period dates
  const stripe = getStripe();
  const stripeSub = await stripe.subscriptions.retrieve(stripeSubId);

  subscriptionStore.update(sub.id, {
    status: stripeSub.status,
    accessLevel: mapStripeStatusToAccess(stripeSub.status, stripeSub.cancel_at_period_end),
    currentPeriodStart: new Date(stripeSub.items.data[0]?.current_period_start ? stripeSub.items.data[0].current_period_start * 1000 : Date.now()).toISOString(),
    currentPeriodEnd: new Date(stripeSub.items.data[0]?.current_period_end ? stripeSub.items.data[0].current_period_end * 1000 : Date.now()).toISOString(),
  });

  console.log(`[stripe/webhook] invoice.paid — access extended for subscription ${stripeSubId}`);
}

/**
 * invoice.payment_failed — flag account, trigger dunning flow.
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const stripeSubId = getSubscriptionIdFromInvoice(invoice);
  if (!stripeSubId) return;

  const sub = subscriptionStore.getByStripeSubscriptionId(stripeSubId);
  if (!sub) {
    console.warn(`[stripe/webhook] invoice.payment_failed — no subscription found for ${stripeSubId}`);
    return;
  }

  subscriptionStore.update(sub.id, {
    status: "past_due",
    accessLevel: "past_due",
  });

  console.log(`[stripe/webhook] invoice.payment_failed — flagged subscription ${stripeSubId} as past_due (attempt ${invoice.attempt_count})`);
  // TODO: Trigger dunning email flow via email provider
}

/**
 * customer.subscription.trial_will_end — send 3-day trial expiry warning.
 */
async function handleTrialWillEnd(stripeSub: Stripe.Subscription): Promise<void> {
  const sub = subscriptionStore.getByStripeSubscriptionId(stripeSub.id);
  if (!sub) {
    console.warn(`[stripe/webhook] trial_will_end — no subscription found for ${stripeSub.id}`);
    return;
  }

  console.log(`[stripe/webhook] trial_will_end — trial ending for ${sub.email} (subscription ${stripeSub.id}, ends ${sub.trialEnd})`);
  // TODO: Send trial expiry warning email via email provider
}

/**
 * subscription.deleted — revoke access.
 */
async function handleSubscriptionDeleted(stripeSub: Stripe.Subscription): Promise<void> {
  const sub = subscriptionStore.getByStripeSubscriptionId(stripeSub.id);
  if (!sub) {
    console.warn(`[stripe/webhook] subscription.deleted — no subscription found for ${stripeSub.id}`);
    return;
  }

  subscriptionStore.update(sub.id, {
    status: "canceled",
    accessLevel: "cancelled",
    cancelAtPeriodEnd: false,
  });

  console.log(`[stripe/webhook] subscription.deleted — access revoked for ${sub.email} (subscription ${stripeSub.id})`);
}

/**
 * customer.updated — sync customer metadata.
 */
async function handleCustomerUpdated(customer: Stripe.Customer): Promise<void> {
  const subs = subscriptionStore.getByStripeCustomerId(customer.id);
  if (subs.length === 0) {
    console.log(`[stripe/webhook] customer.updated — no subscriptions for customer ${customer.id}`);
    return;
  }

  for (const sub of subs) {
    subscriptionStore.update(sub.id, {
      email: customer.email ?? sub.email,
    });
  }

  console.log(`[stripe/webhook] customer.updated — synced metadata for customer ${customer.id} (${subs.length} subscription(s))`);
}

/**
 * payment_intent.payment_failed — log failed payment attempt.
 */
async function handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  const lastError = paymentIntent.last_payment_error;
  console.error(
    `[stripe/webhook] payment_intent.payment_failed — PI ${paymentIntent.id}, ` +
    `customer ${typeof paymentIntent.customer === "string" ? paymentIntent.customer : paymentIntent.customer?.id ?? "unknown"}, ` +
    `error: ${lastError?.message ?? "unknown"} (code: ${lastError?.code ?? "none"})`
  );
}

export default router;
