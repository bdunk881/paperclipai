import { evaluateBreaches, type CostThreshold } from "./costThresholdsStore";

function threshold(overrides: Partial<CostThreshold>): CostThreshold {
  return {
    id: "t1",
    metric: "openrouter",
    bucket: "projected_daily",
    ceiling_value: 50,
    note: null,
    created_by: "u1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    disabled_at: null,
    ...overrides,
  };
}

const payloadAt = (overrides: Record<string, unknown>) => ({
  openrouter: {
    prepaid_balance_usd: 200,
    trailing_24h: { spend_usd: 8 },
    trailing_7d: { spend_usd: 56 },
    trailing_30d: { spend_usd: 240 },
    projected_daily_usd: 8,
    projected_monthly_usd: 240,
    ...overrides,
  },
});

describe("evaluateBreaches", () => {
  it("flags when an above-ceiling bucket exceeds the threshold", () => {
    const t = threshold({ bucket: "projected_daily", ceiling_value: 5 });
    const [breach] = evaluateBreaches([t], payloadAt({ projected_daily_usd: 8 }));
    expect(breach.breached).toBe(true);
    expect(breach.observed_value).toBe(8);
    expect(breach.direction).toBe("above_ceiling_breaches");
  });

  it("does not flag when value equals the ceiling exactly", () => {
    const t = threshold({ bucket: "projected_daily", ceiling_value: 8 });
    const [breach] = evaluateBreaches([t], payloadAt({ projected_daily_usd: 8 }));
    expect(breach.breached).toBe(false);
  });

  it("flags runway-days when value falls BELOW the ceiling", () => {
    // balance 10 ÷ projected 5/day → 2 days runway
    const t = threshold({ bucket: "balance_runway_days", ceiling_value: 7 });
    const [breach] = evaluateBreaches(
      [t],
      payloadAt({ prepaid_balance_usd: 10, projected_daily_usd: 5 }),
    );
    expect(breach.breached).toBe(true);
    expect(breach.observed_value).toBe(2);
    expect(breach.direction).toBe("below_ceiling_breaches");
  });

  it("does not flag runway-days when value is above the ceiling", () => {
    // balance 200 ÷ projected 8/day = 25 days runway
    const t = threshold({ bucket: "balance_runway_days", ceiling_value: 7 });
    const [breach] = evaluateBreaches([t], payloadAt({}));
    expect(breach.breached).toBe(false);
    expect(breach.observed_value).toBe(25);
  });

  it("emits observed=null when the metric is missing from the payload", () => {
    const t = threshold({ bucket: "trailing_24h", ceiling_value: 5 });
    const [breach] = evaluateBreaches(
      [t],
      { openrouter: { /* trailing_24h missing */ } } as unknown as Record<string, unknown>,
    );
    expect(breach.observed_value).toBeNull();
    expect(breach.breached).toBe(false);
  });

  it("emits observed=null when balance is null (can't compute runway)", () => {
    const t = threshold({ bucket: "balance_runway_days", ceiling_value: 7 });
    const [breach] = evaluateBreaches(
      [t],
      payloadAt({ prepaid_balance_usd: null }),
    );
    expect(breach.observed_value).toBeNull();
    expect(breach.breached).toBe(false);
  });

  it("evaluates multiple thresholds independently", () => {
    const ts: CostThreshold[] = [
      threshold({ id: "a", bucket: "projected_daily", ceiling_value: 5 }),
      threshold({ id: "b", bucket: "trailing_30d", ceiling_value: 100 }),
    ];
    const result = evaluateBreaches(ts, payloadAt({}));
    expect(result.find((b) => b.threshold_id === "a")?.breached).toBe(true); // 8 > 5
    expect(result.find((b) => b.threshold_id === "b")?.breached).toBe(true); // 240 > 100
  });
});
