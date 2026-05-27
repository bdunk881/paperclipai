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

export type TierKey = string;

export function resolveStripePriceId(envName: string | null): string {
  if (!envName) return "";
  return (process.env[envName] ?? "").trim();
}
