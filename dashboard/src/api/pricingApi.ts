import { getApiBasePath } from "./baseUrl";

const BASE = getApiBasePath();

/**
 * Public pricing endpoint — no auth required. Same shape as the landing's
 * loader (see landing/app/page.tsx). Mounted at /api/public/landing/pricing
 * in src/app.ts; HEL-267 owns the source of truth.
 */
export interface PricingTier {
  id: string;
  displayName: string;
  priceUsdCents: number;
  currency: string;
  trialDays: number;
  sortOrder: number;
  isPopular: boolean;
  features: string[];
  ctaLabel: string;
  priceUnit: string;
}

export interface PricingPack {
  id: string;
  displayName: string;
  priceUsdCents: number;
  creditsGranted: number;
  bonusPercent: number;
  sortOrder: number;
}

export interface Pricing {
  tiers: PricingTier[];
  packs: PricingPack[];
}

export async function getPricing(): Promise<Pricing> {
  const res = await fetch(`${BASE}/public/landing/pricing`);
  if (!res.ok) {
    throw new Error(`Load pricing failed: ${res.status}`);
  }
  return res.json() as Promise<Pricing>;
}
