/**
 * Subscription store — Stripe subscriptions mapped to internal access levels.
 *
 * DASH-47: every read method is async and falls back to Postgres on
 * in-memory miss. The four `Map<>` mirrors stay as a low-latency
 * read cache — important for webhook handlers that fire repeatedly for
 * the same customer — but they're no longer the source of truth. A
 * miss because hydration hasn't finished, or because a different
 * process wrote the row, now resolves correctly instead of returning
 * undefined and looking like the customer has no subscription.
 *
 * Write path: `upsert` still goes to memory (so the next in-process
 * read is fast); the canonical write lives in
 * `billingRepository.upsertSubscriptionAndEntitlements`, called from
 * `stripeWebhook.ts::syncSubscriptionEntitlements` after every change.
 */

import { billingRepository } from "./billingRepository";

export type SubscriptionTier = "explore" | "flow" | "automate" | "scale";
export type AccessLevel = "trial" | "active" | "past_due" | "cancelled" | "none";

function configuredPriceIds(): { flow: string[]; automate: string[]; scale: string[] } {
  const collect = (...values: Array<string | undefined>): string[] =>
    values
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim());

  return {
    flow: collect(
      process.env.STRIPE_FLOW_PRICE_ID,
      process.env.STRIPE_PRICE_FLOW,
      process.env.STRIPE_PRICE_STARTER,
    ),
    automate: collect(
      process.env.STRIPE_AUTOMATE_PRICE_ID,
      process.env.STRIPE_PRICE_AUTOMATE,
      process.env.STRIPE_PRICE_PROFESSIONAL,
      process.env.STRIPE_PRICE_PRO,
    ),
    scale: collect(
      process.env.STRIPE_SCALE_PRICE_ID,
      process.env.STRIPE_PRICE_SCALE,
      process.env.STRIPE_PRICE_ENTERPRISE,
    ),
  };
}

export interface Subscription {
  id: string;
  workspaceId?: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  userId: string;
  email: string;
  tier: SubscriptionTier;
  accessLevel: AccessLevel;
  status: string; // raw Stripe status
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialEnd: string | null;
  createdAt: string;
  updatedAt: string;
}

// DASH-47: in-memory mirrors stay as a low-latency cache for hot-path
// webhook + per-request lookups. Cache miss now falls back to Postgres
// via billingRepository.findX — no more silent "undefined" for rows
// that exist in the DB but aren't in this process's memory yet.
// allowlist: hot-path read cache; canonical state lives in Postgres (DASH-47..51)
const store = new Map<string, Subscription>();
// allowlist: hot-path read cache; canonical state lives in Postgres (DASH-47..51)
const byStripeSubId = new Map<string, string>();
// allowlist: hot-path read cache; canonical state lives in Postgres (DASH-47..51)
const byStripeCustomerId = new Map<string, string[]>();
// allowlist: hot-path read cache; canonical state lives in Postgres (DASH-47..51)
const byUserId = new Map<string, string>();

function addIndex(sub: Subscription): void {
  byStripeSubId.set(sub.stripeSubscriptionId, sub.id);
  const custSubs = byStripeCustomerId.get(sub.stripeCustomerId) ?? [];
  if (!custSubs.includes(sub.id)) custSubs.push(sub.id);
  byStripeCustomerId.set(sub.stripeCustomerId, custSubs);
  if (sub.userId) byUserId.set(sub.userId, sub.id);
}

function cacheRecord(sub: Subscription): Subscription {
  store.set(sub.id, sub);
  addIndex(sub);
  return sub;
}

/** Map Stripe subscription status to internal access level */
export function mapStripeStatusToAccess(stripeStatus: string, cancelAtPeriodEnd: boolean): AccessLevel {
  switch (stripeStatus) {
    case "trialing":
      return "trial";
    case "active":
      return cancelAtPeriodEnd ? "active" : "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return "cancelled";
    default:
      return "none";
  }
}

/** Map Stripe price ID or metadata tier to internal tier */
export function resolveTier(metadata?: Record<string, string>, priceId?: string): SubscriptionTier {
  const tierFromMeta = metadata?.tier as SubscriptionTier | undefined;
  if (tierFromMeta && ["explore", "flow", "automate", "scale"].includes(tierFromMeta)) {
    return tierFromMeta;
  }
  if (priceId) {
    const prices = configuredPriceIds();
    if (prices.scale.includes(priceId)) return "scale";
    if (prices.automate.includes(priceId)) return "automate";
    if (prices.flow.includes(priceId)) return "flow";
  }
  return "explore";
}

export const subscriptionStore = {
  upsert(sub: Subscription): Subscription {
    return cacheRecord(sub);
  },

  async get(id: string): Promise<Subscription | undefined> {
    const cached = store.get(id);
    if (cached) return cached;
    const persisted = await billingRepository.findById(id);
    return persisted ? cacheRecord(persisted) : undefined;
  },

  async getByStripeSubscriptionId(stripeSubId: string): Promise<Subscription | undefined> {
    const cachedId = byStripeSubId.get(stripeSubId);
    if (cachedId) {
      const cached = store.get(cachedId);
      if (cached) return cached;
    }
    const persisted = await billingRepository.findByStripeSubscriptionId(stripeSubId);
    return persisted ? cacheRecord(persisted) : undefined;
  },

  async getByUserId(userId: string): Promise<Subscription | undefined> {
    const cachedId = byUserId.get(userId);
    if (cachedId) {
      const cached = store.get(cachedId);
      if (cached) return cached;
    }
    const persisted = await billingRepository.findByUserId(userId);
    return persisted ? cacheRecord(persisted) : undefined;
  },

  async getByStripeCustomerId(customerId: string): Promise<Subscription[]> {
    const cachedIds = byStripeCustomerId.get(customerId);
    if (cachedIds && cachedIds.length > 0) {
      const cached = cachedIds
        .map((id) => store.get(id))
        .filter((s): s is Subscription => Boolean(s));
      if (cached.length > 0) return cached;
    }
    const persisted = await billingRepository.findByStripeCustomerId(customerId);
    for (const sub of persisted) cacheRecord(sub);
    return persisted;
  },

  async update(id: string, patch: Partial<Subscription>): Promise<Subscription | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    return cacheRecord(updated);
  },

  list(): Subscription[] {
    return Array.from(store.values());
  },

  clear(): void {
    store.clear();
    byStripeSubId.clear();
    byStripeCustomerId.clear();
    byUserId.clear();
  },

  /**
   * HEL-45: rebuild the in-memory cache from Postgres at app startup.
   * Still useful (warms the cache so the first webhook is fast), but
   * post-DASH-47 the read methods don't depend on this for correctness —
   * each one falls back to Postgres on its own.
   */
  async hydrateFromPostgres(): Promise<number> {
    const rows = await billingRepository.loadAllSubscriptions();
    for (const sub of rows) {
      cacheRecord(sub);
    }
    return rows.length;
  },
};
