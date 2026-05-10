/**
 * Subscription store — Stripe subscriptions mapped to internal access levels.
 *
 * Read path is in-memory (Map<id, Subscription>) for low-latency lookups
 * during webhook handling and per-request access checks. Write path mirrors
 * to Postgres via `billingRepository.upsertSubscriptionAndEntitlements`
 * (called from `stripeWebhook.ts::syncSubscriptionEntitlements` after every
 * upsert) so the data survives a process restart.
 *
 * `hydrateFromPostgres()` repopulates the in-memory map at app boot — see
 * `src/app.ts` startup. Without that hydration, an API restart would lose
 * all subscription state until the next webhook arrived for each customer
 * (HEL-45 was the urgent fix that closed this gap).
 */

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

const store = new Map<string, Subscription>();
// Secondary indexes
const byStripeSubId = new Map<string, string>();
const byStripeCustomerId = new Map<string, string[]>();
const byUserId = new Map<string, string>();

function addIndex(sub: Subscription): void {
  byStripeSubId.set(sub.stripeSubscriptionId, sub.id);
  const custSubs = byStripeCustomerId.get(sub.stripeCustomerId) ?? [];
  if (!custSubs.includes(sub.id)) custSubs.push(sub.id);
  byStripeCustomerId.set(sub.stripeCustomerId, custSubs);
  if (sub.userId) byUserId.set(sub.userId, sub.id);
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
  // Fallback: match against known price env vars
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
    store.set(sub.id, sub);
    addIndex(sub);
    return sub;
  },

  get(id: string): Subscription | undefined {
    return store.get(id);
  },

  getByStripeSubscriptionId(stripeSubId: string): Subscription | undefined {
    const id = byStripeSubId.get(stripeSubId);
    return id ? store.get(id) : undefined;
  },

  getByUserId(userId: string): Subscription | undefined {
    const id = byUserId.get(userId);
    return id ? store.get(id) : undefined;
  },

  getByStripeCustomerId(customerId: string): Subscription[] {
    const ids = byStripeCustomerId.get(customerId) ?? [];
    return ids.map((id) => store.get(id)).filter(Boolean) as Subscription[];
  },

  update(id: string, patch: Partial<Subscription>): Subscription | undefined {
    const existing = store.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    store.set(id, updated);
    addIndex(updated);
    return updated;
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
   *
   * Imports lazily so this module stays Postgres-agnostic at import time
   * (the test suite mocks billingRepository or runs without DATABASE_URL).
   * Returns the count of subscriptions hydrated; safe to call multiple
   * times — re-hydration overwrites any in-memory entries with the
   * latest persisted state.
   */
  async hydrateFromPostgres(): Promise<number> {
    const { billingRepository } = await import("./billingRepository");
    const rows = await billingRepository.loadAllSubscriptions();
    for (const sub of rows) {
      store.set(sub.id, sub);
      addIndex(sub);
    }
    return rows.length;
  },
};
