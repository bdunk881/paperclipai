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
import { billingRepository, effectiveEntitlementPlan } from "./billingRepository";
import { entitlementStore } from "./entitlements";

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

function getSubscriptionItem(stripeSub: Stripe.Subscription): Stripe.SubscriptionItem | undefined {
  return stripeSub.items.data[0];
}

function getCurrentPeriodStart(stripeSub: Stripe.Subscription): string {
  const periodStart = getSubscriptionItem(stripeSub)?.current_period_start;
  return new Date(periodStart ? periodStart * 1000 : Date.now()).toISOString();
}

function getCurrentPeriodEnd(stripeSub: Stripe.Subscription): string {
  const periodEnd = getSubscriptionItem(stripeSub)?.current_period_end;
  return new Date(periodEnd ? periodEnd * 1000 : Date.now()).toISOString();
}

function getStripeCustomerId(value: Stripe.Subscription["customer"] | Stripe.Checkout.Session["customer"]): string {
  return typeof value === "string" ? value : value?.id ?? "";
}

async function syncSubscriptionEntitlements(sub: Subscription): Promise<void> {
  if (!sub.workspaceId) {
    return;
  }

  const entitlementPlan = effectiveEntitlementPlan(sub.tier, sub.status);
  entitlementStore.upsert(sub.workspaceId, entitlementPlan);
  await billingRepository.upsertSubscriptionAndEntitlements({
    workspaceId: sub.workspaceId,
    userId: sub.userId,
    stripeSubscriptionId: sub.stripeSubscriptionId,
    stripeCustomerId: sub.stripeCustomerId,
    plan: sub.tier,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
  });
}

function buildSubscriptionRecord(params: {
  existing?: Subscription;
  stripeSub: Stripe.Subscription;
  stripeSubscriptionId?: string;
  metadata: Record<string, string>;
  email?: string;
  workspaceId?: string;
  userId?: string;
  tier?: ReturnType<typeof resolveTier>;
}): Subscription {
  const now = new Date().toISOString();
  const priceId = getSubscriptionItem(params.stripeSub)?.price?.id;
  const tier = params.tier ?? resolveTier(params.metadata, priceId);
  return {
    id: params.existing?.id ?? randomUUID(),
    workspaceId: params.workspaceId ?? params.metadata.workspaceId ?? params.existing?.workspaceId,
    stripeSubscriptionId: params.stripeSubscriptionId ?? params.stripeSub.id,
    stripeCustomerId: getStripeCustomerId(params.stripeSub.customer),
    userId: params.userId ?? params.metadata.userId ?? params.existing?.userId ?? "",
    email: params.email ?? params.metadata.email ?? params.existing?.email ?? "",
    tier,
    accessLevel: mapStripeStatusToAccess(params.stripeSub.status, params.stripeSub.cancel_at_period_end),
    status: params.stripeSub.status,
    currentPeriodStart: getCurrentPeriodStart(params.stripeSub),
    currentPeriodEnd: getCurrentPeriodEnd(params.stripeSub),
    cancelAtPeriodEnd: params.stripeSub.cancel_at_period_end,
    trialEnd: params.stripeSub.trial_end ? new Date(params.stripeSub.trial_end * 1000).toISOString() : null,
    createdAt: params.existing?.createdAt ?? now,
    updatedAt: now,
  };
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
  const workspaceId = meta.workspaceId ?? "";
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
  const priceId = getSubscriptionItem(stripeSub)?.price?.id;
  const tier = resolveTier(meta, priceId);

  const existing = subscriptionStore.getByStripeSubscriptionId(stripeSubId);
  const sub = buildSubscriptionRecord({
    existing,
    stripeSub,
    stripeSubscriptionId: stripeSubId,
    metadata: meta,
    email,
    userId,
    workspaceId,
    tier,
  });

  subscriptionStore.upsert(sub);
  await syncSubscriptionEntitlements(sub);
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
    const updated = subscriptionStore.update(existing.id, {
      workspaceId: existing.workspaceId ?? stripeSub.metadata?.workspaceId,
      status: stripeSub.status,
      accessLevel: mapStripeStatusToAccess(stripeSub.status, stripeSub.cancel_at_period_end),
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
      currentPeriodStart: getCurrentPeriodStart(stripeSub),
      currentPeriodEnd: getCurrentPeriodEnd(stripeSub),
    });
    if (updated) {
      await syncSubscriptionEntitlements(updated);
    }
    console.log(`[stripe/webhook] subscription.created — updated existing record for ${stripeSub.id}`);
    return;
  }

  const meta = (stripeSub.metadata ?? {}) as Record<string, string>;
  const tier = resolveTier(meta, getSubscriptionItem(stripeSub)?.price?.id);
  const sub = buildSubscriptionRecord({ stripeSub, metadata: meta, tier });

  subscriptionStore.upsert(sub);
  await syncSubscriptionEntitlements(sub);
  console.log(`[stripe/webhook] subscription.created — recorded new ${tier} subscription ${stripeSub.id}`);
}

/**
 * invoice.paid — confirm payment, extend access.
 */
async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const stripeSubId = getSubscriptionIdFromInvoice(invoice);
  if (!stripeSubId) return;

  // Fetch updated subscription to get new period dates
  const stripe = getStripe();
  const stripeSub = await stripe.subscriptions.retrieve(stripeSubId);
  const sub = subscriptionStore.getByStripeSubscriptionId(stripeSubId);
  if (!sub) {
    const metadata = (stripeSub.metadata ?? {}) as Record<string, string>;
    const created = buildSubscriptionRecord({ stripeSub, metadata });
    subscriptionStore.upsert(created);
    await syncSubscriptionEntitlements(created);
    console.warn(`[stripe/webhook] invoice.paid — created missing subscription cache for ${stripeSubId}`);
    return;
  }

  const updated = subscriptionStore.update(sub.id, {
    status: stripeSub.status,
    accessLevel: mapStripeStatusToAccess(stripeSub.status, stripeSub.cancel_at_period_end),
    currentPeriodStart: getCurrentPeriodStart(stripeSub),
    currentPeriodEnd: getCurrentPeriodEnd(stripeSub),
  });
  if (updated) {
    await syncSubscriptionEntitlements(updated);
  }

  console.log(`[stripe/webhook] invoice.paid — access extended for subscription ${stripeSubId}`);
}

/**
 * invoice.payment_failed — flag account, trigger dunning flow.
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const stripeSubId = getSubscriptionIdFromInvoice(invoice);
  if (!stripeSubId) return;

  let sub = subscriptionStore.getByStripeSubscriptionId(stripeSubId);
  if (!sub) {
    const stripe = getStripe();
    const stripeSub = await stripe.subscriptions.retrieve(stripeSubId);
    const metadata = (stripeSub.metadata ?? {}) as Record<string, string>;
    sub = subscriptionStore.upsert(buildSubscriptionRecord({ stripeSub, metadata }));
    console.warn(`[stripe/webhook] invoice.payment_failed — created missing subscription cache for ${stripeSubId}`);
  }

  const updated = subscriptionStore.update(sub.id, {
    status: "past_due",
    accessLevel: "past_due",
  });
  if (updated) {
    await syncSubscriptionEntitlements(updated);
  }

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
  let sub = subscriptionStore.getByStripeSubscriptionId(stripeSub.id);
  if (!sub) {
    const metadata = (stripeSub.metadata ?? {}) as Record<string, string>;
    sub = subscriptionStore.upsert(buildSubscriptionRecord({ stripeSub, metadata }));
    console.warn(`[stripe/webhook] subscription.deleted — created missing subscription cache for ${stripeSub.id}`);
  }

  const updated = subscriptionStore.update(sub.id, {
    status: "canceled",
    accessLevel: "cancelled",
    cancelAtPeriodEnd: false,
  });
  if (updated) {
    await syncSubscriptionEntitlements(updated);
  }

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
