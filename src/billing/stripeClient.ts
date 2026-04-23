/**
 * Shared Stripe client for the backend.
 * Accepts both STRIPE_SECRET_KEY and the Paperclip adapter's STRIPE_API_KEY.
 */

import Stripe from "stripe";

let _stripe: Stripe | undefined;

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = firstNonEmpty(process.env.STRIPE_SECRET_KEY, process.env.STRIPE_API_KEY);
    if (!key) {
      throw new Error("Stripe secret key environment variable is not set");
    }
    _stripe = new Stripe(key);
  }
  return _stripe;
}

/** Pricing tiers — matches landing/lib/stripe.ts */
export const PRICING_TIERS = {
  explore: {
    name: "Explore",
    price: 0,
    priceId: null,
    trialDays: 0,
  },
  flow: {
    name: "Flow",
    price: 19,
    priceId: firstNonEmpty(
      process.env.STRIPE_FLOW_PRICE_ID,
      process.env.STRIPE_PRICE_FLOW,
      process.env.STRIPE_PRICE_STARTER,
    ),
    trialDays: 14,
  },
  automate: {
    name: "Automate",
    price: 49,
    priceId: firstNonEmpty(
      process.env.STRIPE_AUTOMATE_PRICE_ID,
      process.env.STRIPE_PRICE_AUTOMATE,
      process.env.STRIPE_PRICE_PROFESSIONAL,
      process.env.STRIPE_PRICE_PRO,
    ),
    trialDays: 14,
  },
  scale: {
    name: "Scale",
    price: 99,
    priceId: firstNonEmpty(
      process.env.STRIPE_SCALE_PRICE_ID,
      process.env.STRIPE_PRICE_SCALE,
      process.env.STRIPE_PRICE_ENTERPRISE,
    ),
    trialDays: 0,
  },
} as const;

export type TierKey = keyof typeof PRICING_TIERS;
