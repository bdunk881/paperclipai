/**
 * tiersRepository fallback unit tests. The integration with /api/public/landing/pricing
 * is covered by src/landing/publicApiRoutes.test.ts.
 *
 * Under Jest, `isPostgresConfigured()` returns false, so these tests exercise
 * the in-memory DEFAULT_TIERS fallback path that mirrors the seed in
 * migrations/079_subscription_tiers.sql.
 */
import { DEFAULT_TIERS, listEnabledTiers, getTierById } from "./tiersRepository";

describe("tiersRepository (in-memory fallback)", () => {
  it("returns the 4 confirmed tiers in sort_order", async () => {
    const tiers = await listEnabledTiers();
    expect(tiers.map((t) => t.id)).toEqual(["explore", "flow", "automate", "scale"]);
  });

  it("returns tiers with marketing-ready fields populated", async () => {
    const tiers = await listEnabledTiers();
    for (const tier of tiers) {
      expect(tier.displayName.length).toBeGreaterThan(0);
      expect(tier.ctaLabel.length).toBeGreaterThan(0);
      expect(tier.features.length).toBeGreaterThan(0);
      expect(tier.priceUsdCents).toBeGreaterThanOrEqual(0);
    }
  });

  it("marks the Automate tier as the most popular", async () => {
    const tiers = await listEnabledTiers();
    const automate = tiers.find((t) => t.id === "automate");
    expect(automate?.isPopular).toBe(true);
    expect(tiers.filter((t) => t.isPopular)).toHaveLength(1);
  });

  it("leaves stripe_price_env empty on the free tier", async () => {
    const explore = await getTierById("explore");
    expect(explore?.stripePriceEnv).toBeNull();
    expect(explore?.priceUsdCents).toBe(0);
  });

  it("returns null for unknown tier ids", async () => {
    expect(await getTierById("does-not-exist")).toBeNull();
  });

  it("exposes a stripe_price_env hint for each paid tier", async () => {
    for (const tier of DEFAULT_TIERS) {
      if (tier.priceUsdCents > 0) {
        expect(tier.stripePriceEnv).toMatch(/^STRIPE_[A-Z_]+_PRICE_ID$/);
      }
    }
  });

  it("carries price_unit so the landing can render /mo vs /seat/mo", async () => {
    const tiers = await listEnabledTiers();
    const byId = Object.fromEntries(tiers.map((t) => [t.id, t.priceUnit]));
    expect(byId.explore).toBe("/mo");
    expect(byId.flow).toBe("/mo");
    expect(byId.automate).toBe("/seat/mo");
    expect(byId.scale).toBe("/seat/mo");
  });
});
