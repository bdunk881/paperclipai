/**
 * Subscription tier catalog — DB-backed source-of-truth for the tier ladder.
 * Mirrors the seed in migration 079_subscription_tiers.sql. The DB row wins
 * when present; an in-memory fallback covers tests and bootstrap.
 *
 * Stripe Price IDs are NOT stored in the DB — `stripe_price_env` holds the
 * env-var name to resolve at runtime so the same row works across Stripe
 * test/live modes.
 */
import { isPostgresConfigured, queryPostgres } from "../db/postgres";

export interface SubscriptionTier {
  id: string;
  displayName: string;
  priceUsdCents: number;
  currency: string;
  stripePriceEnv: string | null;
  trialDays: number;
  sortOrder: number;
  isPopular: boolean;
  features: string[];
  ctaLabel: string;
  enabled: boolean;
}

export const DEFAULT_TIERS: readonly SubscriptionTier[] = [
  {
    id: "explore",
    displayName: "Explore",
    priceUsdCents: 0,
    currency: "usd",
    stripePriceEnv: null,
    trialDays: 0,
    sortOrder: 10,
    isPopular: false,
    features: ["3 workspaces", "Daily Sonnet credit cap", "Community support"],
    ctaLabel: "Get started",
    enabled: true,
  },
  {
    id: "flow",
    displayName: "Flow",
    priceUsdCents: 1900,
    currency: "usd",
    stripePriceEnv: "STRIPE_FLOW_PRICE_ID",
    trialDays: 14,
    sortOrder: 20,
    isPopular: false,
    features: [
      "Everything in Explore",
      "Unlimited workspaces",
      "5,000 daily Sonnet credits",
      "Priority email support",
    ],
    ctaLabel: "Start 14-day trial",
    enabled: true,
  },
  {
    id: "automate",
    displayName: "Automate",
    priceUsdCents: 4900,
    currency: "usd",
    stripePriceEnv: "STRIPE_AUTOMATE_PRICE_ID",
    trialDays: 14,
    sortOrder: 30,
    isPopular: true,
    features: [
      "Everything in Flow",
      "20,000 daily credits",
      "Opus model access",
      "Slack support",
      "Custom approval policies",
    ],
    ctaLabel: "Start 14-day trial",
    enabled: true,
  },
  {
    id: "scale",
    displayName: "Scale",
    priceUsdCents: 9900,
    currency: "usd",
    stripePriceEnv: "STRIPE_SCALE_PRICE_ID",
    trialDays: 0,
    sortOrder: 40,
    isPopular: false,
    features: [
      "Everything in Automate",
      "Unlimited daily credits",
      "SSO + audit logs",
      "Dedicated success manager",
      "Custom SLAs",
    ],
    ctaLabel: "Talk to sales",
    enabled: true,
  },
];

interface TierRow {
  id: string;
  display_name: string;
  price_usd_cents: number;
  currency: string;
  stripe_price_env: string | null;
  trial_days: number;
  sort_order: number;
  is_popular: boolean;
  features: unknown;
  cta_label: string;
  enabled: boolean;
}

function rowToTier(row: TierRow): SubscriptionTier {
  const features = Array.isArray(row.features)
    ? row.features.filter((f): f is string => typeof f === "string")
    : [];
  return {
    id: row.id,
    displayName: row.display_name,
    priceUsdCents: row.price_usd_cents,
    currency: row.currency,
    stripePriceEnv: row.stripe_price_env,
    trialDays: row.trial_days,
    sortOrder: row.sort_order,
    isPopular: row.is_popular,
    features,
    ctaLabel: row.cta_label,
    enabled: row.enabled,
  };
}

const SELECT_COLUMNS = `id, display_name, price_usd_cents, currency,
                        stripe_price_env, trial_days, sort_order,
                        is_popular, features, cta_label, enabled`;

export async function listEnabledTiers(): Promise<SubscriptionTier[]> {
  if (isPostgresConfigured()) {
    const result = await queryPostgres<TierRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM subscription_tiers
        WHERE enabled = true
        ORDER BY sort_order ASC`,
    );
    return result.rows.map(rowToTier);
  }
  return DEFAULT_TIERS.filter((t) => t.enabled).slice().sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
}

export async function getTierById(id: string): Promise<SubscriptionTier | null> {
  if (isPostgresConfigured()) {
    const result = await queryPostgres<TierRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM subscription_tiers
        WHERE id = $1
        LIMIT 1`,
      [id],
    );
    if (result.rowCount === 0) return null;
    return rowToTier(result.rows[0]);
  }
  return DEFAULT_TIERS.find((t) => t.id === id) ?? null;
}
