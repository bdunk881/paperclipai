/**
 * Credit-pack catalog — the source-of-truth for what each Stripe SKU
 * grants. Mirrors the seed in migration 071. The DB row wins when present.
 *
 * Stripe Price IDs come from env vars at deploy time and get patched
 * into the DB via an admin endpoint or a follow-up migration once Brad
 * has created the Prices in the Stripe dashboard.
 */
import {
  isPostgresConfigured,
  queryPostgres,
} from "../../db/postgres";

export interface CreditPack {
  id: string;
  displayName: string;
  stripePriceId: string;
  priceUsdCents: number;
  creditsGranted: bigint;
  bonusPercent: number;
  enabled: boolean;
  sortOrder: number;
}

export const DEFAULT_PACKS: readonly CreditPack[] = [
  { id: "pack_25",  displayName: "Starter Pack", stripePriceId: "price_PLACEHOLDER_pack_25",  priceUsdCents: 2500,  creditsGranted: 250000n,  bonusPercent: 0,  enabled: true, sortOrder: 10 },
  { id: "pack_50",  displayName: "Plus Pack",    stripePriceId: "price_PLACEHOLDER_pack_50",  priceUsdCents: 5000,  creditsGranted: 525000n,  bonusPercent: 5,  enabled: true, sortOrder: 20 },
  { id: "pack_100", displayName: "Pro Pack",     stripePriceId: "price_PLACEHOLDER_pack_100", priceUsdCents: 10000, creditsGranted: 1100000n, bonusPercent: 10, enabled: true, sortOrder: 30 },
  { id: "pack_250", displayName: "Scale Pack",   stripePriceId: "price_PLACEHOLDER_pack_250", priceUsdCents: 25000, creditsGranted: 2875000n, bonusPercent: 15, enabled: true, sortOrder: 40 },
  { id: "pack_500", displayName: "Power Pack",   stripePriceId: "price_PLACEHOLDER_pack_500", priceUsdCents: 50000, creditsGranted: 6000000n, bonusPercent: 20, enabled: true, sortOrder: 50 },
];

// allowlist: rolling counter / cached config; process-local by design
const inMemoryCatalog = new Map<string, CreditPack>();
// allowlist: rolling counter / cached config; process-local by design
const inMemoryByPriceId = new Map<string, CreditPack>();
for (const pack of DEFAULT_PACKS) {
  inMemoryCatalog.set(pack.id, pack);
  inMemoryByPriceId.set(pack.stripePriceId, pack);
}

interface PackRow {
  id: string;
  display_name: string;
  stripe_price_id: string;
  price_usd_cents: number;
  credits_granted: string;
  bonus_percent: string;
  enabled: boolean;
  sort_order: number;
}

function rowToPack(row: PackRow): CreditPack {
  return {
    id: row.id,
    displayName: row.display_name,
    stripePriceId: row.stripe_price_id,
    priceUsdCents: row.price_usd_cents,
    creditsGranted: BigInt(row.credits_granted),
    bonusPercent: Number(row.bonus_percent),
    enabled: row.enabled,
    sortOrder: row.sort_order,
  };
}

export async function listEnabledPacks(): Promise<CreditPack[]> {
  if (isPostgresConfigured()) {
    const result = await queryPostgres<PackRow>(
      `SELECT id, display_name, stripe_price_id, price_usd_cents,
              credits_granted, bonus_percent, enabled, sort_order
         FROM credit_packs
        WHERE enabled = true
        ORDER BY sort_order ASC`,
    );
    return result.rows.map(rowToPack);
  }
  return [...inMemoryCatalog.values()].filter((p) => p.enabled).sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function getPackById(packId: string): Promise<CreditPack | null> {
  if (isPostgresConfigured()) {
    const result = await queryPostgres<PackRow>(
      `SELECT id, display_name, stripe_price_id, price_usd_cents,
              credits_granted, bonus_percent, enabled, sort_order
         FROM credit_packs
        WHERE id = $1
        LIMIT 1`,
      [packId],
    );
    if (result.rowCount === 0) return null;
    return rowToPack(result.rows[0]);
  }
  return inMemoryCatalog.get(packId) ?? null;
}

export async function getPackByStripePriceId(priceId: string): Promise<CreditPack | null> {
  if (isPostgresConfigured()) {
    const result = await queryPostgres<PackRow>(
      `SELECT id, display_name, stripe_price_id, price_usd_cents,
              credits_granted, bonus_percent, enabled, sort_order
         FROM credit_packs
        WHERE stripe_price_id = $1
        LIMIT 1`,
      [priceId],
    );
    if (result.rowCount === 0) return null;
    return rowToPack(result.rows[0]);
  }
  return inMemoryByPriceId.get(priceId) ?? null;
}
