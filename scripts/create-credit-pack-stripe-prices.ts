/**
 * One-shot script — creates the live Stripe Products + Prices for the
 * 5 credit packs seeded in migration 071_credit_packs.sql, and emits
 * an SQL UPDATE statement to backfill `credit_packs.stripe_price_id`.
 *
 * Why this exists:
 *   credit_packs.stripe_price_id ships with `price_PLACEHOLDER_*`
 *   sentinels. checkoutRoutes.ts refuses to mint Stripe Checkout
 *   sessions until those are replaced with real price IDs. This
 *   script does that without anyone having to click around in the
 *   Stripe dashboard or eyeball five separate price-create dialogs.
 *
 * Usage:
 *
 *   STRIPE_SECRET_KEY=sk_live_... npx ts-node scripts/create-credit-pack-stripe-prices.ts
 *   STRIPE_SECRET_KEY=sk_test_... npx ts-node scripts/create-credit-pack-stripe-prices.ts
 *
 * Output:
 *   - Creates one Stripe Product per pack (or reuses an existing one
 *     with the same lookup_key/id — the script is idempotent on
 *     repeated runs, picking up the existing product and creating a
 *     fresh price)
 *   - Creates one one-time Price per Product
 *   - Prints SQL the user can paste into psql to backfill the IDs
 *
 * Idempotency:
 *   Products are tagged with metadata.pack_id so we can find them on
 *   reruns. Prices are NOT updated (Stripe Prices are immutable) —
 *   if the script runs twice, you get two prices per product and the
 *   most recent one wins via the printed SQL. Old prices stay active
 *   in Stripe but unreferenced by our DB.
 */
import Stripe from "stripe";

interface PackSpec {
  id: string;
  displayName: string;
  priceUsdCents: number;
  creditsGranted: number;
  bonusPercent: number;
}

// Mirror migration 071_credit_packs.sql exactly. Keep these in sync;
// the script intentionally hardcodes them so it doesn't depend on a
// live database connection.
const PACKS: PackSpec[] = [
  { id: "pack_25",  displayName: "Starter Pack", priceUsdCents:  2500, creditsGranted:  250_000, bonusPercent:  0 },
  { id: "pack_50",  displayName: "Plus Pack",    priceUsdCents:  5000, creditsGranted:  525_000, bonusPercent:  5 },
  { id: "pack_100", displayName: "Pro Pack",     priceUsdCents: 10000, creditsGranted: 1_100_000, bonusPercent: 10 },
  { id: "pack_250", displayName: "Scale Pack",   priceUsdCents: 25000, creditsGranted: 2_875_000, bonusPercent: 15 },
  { id: "pack_500", displayName: "Power Pack",   priceUsdCents: 50000, creditsGranted: 6_000_000, bonusPercent: 20 },
];

async function findExistingProduct(
  stripe: Stripe,
  packId: string,
): Promise<Stripe.Product | null> {
  // Stripe's product list-with-metadata-filter doesn't exist as a
  // first-class API; we scan a page and match by metadata. With only
  // 5 packs total it's fine.
  const page = await stripe.products.list({ limit: 100, active: true });
  return page.data.find((p) => p.metadata.pack_id === packId) ?? null;
}

async function ensureProduct(stripe: Stripe, pack: PackSpec): Promise<Stripe.Product> {
  const existing = await findExistingProduct(stripe, pack.id);
  if (existing) {
    console.log(`[${pack.id}] reusing existing product ${existing.id}`);
    return existing;
  }
  const product = await stripe.products.create({
    name: `AutoFlow Credits — ${pack.displayName}`,
    description: `${pack.creditsGranted.toLocaleString()} AutoFlow credits` +
      (pack.bonusPercent > 0 ? ` (includes ${pack.bonusPercent}% bonus)` : ""),
    metadata: {
      pack_id: pack.id,
      credits_granted: pack.creditsGranted.toString(),
      bonus_percent: pack.bonusPercent.toString(),
      source: "credit_packs/migration_071",
    },
    tax_code: "txcd_10103000", // digital services - prepaid
  });
  console.log(`[${pack.id}] created new product ${product.id}`);
  return product;
}

async function createPrice(stripe: Stripe, product: Stripe.Product, pack: PackSpec): Promise<Stripe.Price> {
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: pack.priceUsdCents,
    currency: "usd",
    nickname: `${pack.displayName} — $${(pack.priceUsdCents / 100).toFixed(2)}`,
    metadata: {
      pack_id: pack.id,
      credits_granted: pack.creditsGranted.toString(),
    },
    // No recurring config => one-time payment, which is what we want
    // for credit packs (subscription packs would need a separate flow).
  });
  console.log(`[${pack.id}] created price ${price.id} (${pack.priceUsdCents} cents)`);
  return price;
}

async function main(): Promise<void> {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    console.error("STRIPE_SECRET_KEY is required");
    process.exit(1);
  }
  const isLive = secretKey.startsWith("sk_live_");
  const isTest = secretKey.startsWith("sk_test_");
  if (!isLive && !isTest) {
    console.error("STRIPE_SECRET_KEY must start with sk_live_ or sk_test_");
    process.exit(1);
  }

  console.log(`Using Stripe ${isLive ? "LIVE" : "TEST"} mode`);
  console.log("");

  const stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" });

  const sqlLines: string[] = [];
  for (const pack of PACKS) {
    const product = await ensureProduct(stripe, pack);
    const price = await createPrice(stripe, product, pack);
    sqlLines.push(
      `UPDATE credit_packs SET stripe_price_id = '${price.id}' WHERE id = '${pack.id}';`,
    );
  }

  console.log("");
  console.log("=".repeat(70));
  console.log("Run this SQL against the production database to backfill the IDs:");
  console.log("=".repeat(70));
  console.log("");
  console.log("BEGIN;");
  for (const line of sqlLines) {
    console.log(line);
  }
  console.log("COMMIT;");
  console.log("");
  console.log("After committing, verify with:");
  console.log("  SELECT id, stripe_price_id FROM credit_packs ORDER BY sort_order;");
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
