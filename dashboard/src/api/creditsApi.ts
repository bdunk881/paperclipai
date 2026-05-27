import { getApiBasePath } from "./baseUrl";

const BASE = getApiBasePath();

export interface WalletBalance {
  balanceCredits: string;
  lifetimePurchasedCredits: string;
  lifetimeConsumedCredits: string;
  autoTopupEnabled: boolean;
  autoTopupTriggerCredits?: string | null;
  autoTopupAmountCredits?: string | null;
  updatedAt?: string;
}

export interface CreditPack {
  id: string;
  displayName: string;
  priceUsdCents: number;
  creditsGranted: string;
  bonusPercent: number;
}

export interface ConfirmResult {
  granted?: boolean;
  alreadyGranted?: boolean;
  creditsGranted?: string;
  balanceAfter?: string | null;
}

function authHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

async function jsonOrThrow<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${label} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** GET /api/credits/wallet/balance */
export async function getWalletBalance(accessToken: string): Promise<WalletBalance> {
  const res = await fetch(`${BASE}/credits/wallet/balance`, {
    headers: authHeaders(accessToken),
  });
  return jsonOrThrow<WalletBalance>(res, "Load wallet balance");
}

/** GET /api/credits/checkout/packs */
export async function listCreditPacks(accessToken: string): Promise<CreditPack[]> {
  const res = await fetch(`${BASE}/credits/checkout/packs`, {
    headers: authHeaders(accessToken),
  });
  const body = await jsonOrThrow<{ packs: CreditPack[] }>(res, "Load credit packs");
  return body.packs;
}

/** POST /api/credits/checkout — returns the Stripe Checkout URL to redirect to. */
export async function startCreditPackCheckout(
  accessToken: string,
  packId: string,
): Promise<string> {
  const res = await fetch(`${BASE}/credits/checkout`, {
    method: "POST",
    headers: { ...authHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ packId }),
  });
  const body = await jsonOrThrow<{ url: string }>(res, "Create credits checkout session");
  return body.url;
}

/** POST /api/credits/checkout/confirm — grant credits immediately after Stripe redirect. */
export async function confirmCreditPackPurchase(
  accessToken: string,
  sessionId: string,
): Promise<ConfirmResult> {
  const res = await fetch(`${BASE}/credits/checkout/confirm`, {
    method: "POST",
    headers: { ...authHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  return jsonOrThrow<ConfirmResult>(res, "Confirm credit pack purchase");
}

/**
 * Format a BigInt-as-string credit count to a human-friendly compact label.
 * 1234567 → "1.2M", 12345 → "12.3K", 980 → "980".
 */
export function formatCredits(value: string | bigint | number | null | undefined): string {
  if (value == null) return "0";
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isFinite(n)) return "0";
  if (n < 1000) return n.toLocaleString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

/** Format cents → $X.YZ */
export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Auto-topup (PR #3 — Phase 3, migration 076)
// ---------------------------------------------------------------------------

/**
 * Kick off Stripe Checkout in setup mode to collect a card for
 * off-session auto-topup. Returns the URL to redirect the browser to.
 */
export async function startAutoTopupSetupCheckout(accessToken: string): Promise<string> {
  const res = await fetch(`${BASE}/credits/wallet/setup-checkout`, {
    method: "POST",
    headers: { ...authHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const body = await jsonOrThrow<{ url: string }>(res, "Start auto-topup setup");
  return body.url;
}

/** POST /api/credits/wallet/setup-checkout/confirm — landing-page synchronous handoff. */
export async function confirmAutoTopupSetup(
  accessToken: string,
  sessionId: string,
): Promise<{ ok: boolean; stripeCustomerId?: string; paymentMethodId?: string }> {
  const res = await fetch(`${BASE}/credits/wallet/setup-checkout/confirm`, {
    method: "POST",
    headers: { ...authHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  return jsonOrThrow(res, "Confirm auto-topup setup");
}

export interface AutoTopupPatch {
  enabled: boolean;
  /** Decimal string for bigint compat; only required when enabled=true. */
  triggerCredits?: string;
  amountCredits?: string;
}

/** PATCH /api/credits/wallet/auto-topup — update threshold + amount + enabled. */
export async function patchAutoTopupConfig(
  accessToken: string,
  patch: AutoTopupPatch,
): Promise<void> {
  const res = await fetch(`${BASE}/credits/wallet/auto-topup`, {
    method: "PATCH",
    headers: { ...authHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  await jsonOrThrow(res, "Update auto-topup config");
}
