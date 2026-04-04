/**
 * Shared Stripe client for the backend.
 * Reads STRIPE_SECRET_KEY from the environment.
 */

import Stripe from "stripe";

let _stripe: Stripe | undefined;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY environment variable is not set");
    }
    _stripe = new Stripe(key, { apiVersion: "2025-12-18.acacia" as Stripe.LatestApiVersion });
  }
  return _stripe;
}

/** Pricing tiers — matches landing/lib/stripe.ts */
export const PRICING_TIERS = {
  starter: {
    name: "Starter",
    price: 99,
    priceId: process.env.STRIPE_STARTER_PRICE_ID ?? "",
    trialDays: 14,
  },
  growth: {
    name: "Growth",
    price: 299,
    priceId: process.env.STRIPE_GROWTH_PRICE_ID ?? "",
    trialDays: 14,
  },
  scale: {
    name: "Scale",
    price: 749,
    priceId: process.env.STRIPE_SCALE_PRICE_ID ?? "",
    trialDays: 0,
  },
} as const;

export type TierKey = keyof typeof PRICING_TIERS;
