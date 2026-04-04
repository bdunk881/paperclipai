/**
 * In-memory subscription store.
 * Tracks Stripe subscriptions mapped to internal user access levels.
 * Replace with a PostgreSQL-backed store for production (see ALT-30).
 */

export type SubscriptionTier = "starter" | "growth" | "scale";
export type AccessLevel = "trial" | "active" | "past_due" | "cancelled" | "none";

export interface Subscription {
  id: string;
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
  if (tierFromMeta && ["starter", "growth", "scale"].includes(tierFromMeta)) {
    return tierFromMeta;
  }
  // Fallback: match against known price env vars
  if (priceId) {
    if (priceId === process.env.STRIPE_SCALE_PRICE_ID) return "scale";
    if (priceId === process.env.STRIPE_GROWTH_PRICE_ID) return "growth";
  }
  return "starter";
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
};
