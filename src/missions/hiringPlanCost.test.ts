/**
 * HEL-74 — unit tests for the cost helper. Covers the rate table lookup,
 * tier fallback for unknown models, and rounding semantics.
 */

import { computeHiringPlanCostCents } from "./hiringPlanCost";

describe("computeHiringPlanCostCents (HEL-74)", () => {
  it("computes cost from the exact model rate when it's in the table", () => {
    // claude-sonnet-4-6: $0.003 / 1k prompt + $0.015 / 1k completion.
    // 1000 prompt → $0.003 + 500 completion → $0.0075. Total $0.0105
    // → round-to-cent = 1¢.
    const result = computeHiringPlanCostCents({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      promptTokens: 1000,
      completionTokens: 500,
    });
    expect(result.costCents).toBe(1);
    expect(result.matched).toBe(true);
  });

  it("rounds to the nearest cent (not floor) for sub-cent prompts", () => {
    // gpt-5.4-nano: $0.0002 / 1k prompt + $0.00125 / 1k completion.
    // 100 prompt → $0.00002. 100 completion → $0.000125. Total
    // $0.000145 → round = 0¢. Verifies floor would also be 0.
    const tiny = computeHiringPlanCostCents({
      provider: "openai",
      model: "gpt-5.4-nano",
      promptTokens: 100,
      completionTokens: 100,
    });
    expect(tiny.costCents).toBe(0);
    expect(tiny.matched).toBe(true);

    // gpt-5.4: $0.0025 / 1k prompt + $0.015 / 1k completion.
    // 1000 prompt → $0.0025. 1000 completion → $0.015. Total $0.0175
    // → round = 2¢.
    const small = computeHiringPlanCostCents({
      provider: "openai",
      model: "gpt-5.4",
      promptTokens: 1000,
      completionTokens: 1000,
    });
    expect(small.costCents).toBe(2);
  });

  it("uses sonnet tier fallback for an unlisted Sonnet model", () => {
    // claude-sonnet-99-9 isn't in the table; the fallback heuristic
    // matches "sonnet" → $0.003/$0.015 rate.
    const result = computeHiringPlanCostCents({
      provider: "anthropic",
      model: "claude-sonnet-99-9",
      promptTokens: 5000,
      completionTokens: 5000,
    });
    // 5000 prompt × $0.003/1k = $0.015. 5000 completion × $0.015/1k = $0.075.
    // Total $0.09 → 9¢.
    expect(result.costCents).toBe(9);
    expect(result.matched).toBe(false);
  });

  it("uses opus tier fallback for an unlisted Opus model", () => {
    // claude-opus-4: tier fallback matches "opus" → $0.005/$0.025 rate.
    const result = computeHiringPlanCostCents({
      provider: "anthropic",
      model: "claude-opus-4",
      promptTokens: 1000,
      completionTokens: 1000,
    });
    // 1000 prompt × $0.005/1k = $0.005. 1000 completion × $0.025/1k = $0.025.
    // Total $0.03 → 3¢.
    expect(result.costCents).toBe(3);
    expect(result.matched).toBe(false);
  });

  it("returns 0 cost for a totally unknown model (errs zero rather than guessing)", () => {
    const result = computeHiringPlanCostCents({
      provider: "gemini",
      model: "weird-experimental-7b",
      promptTokens: 1000,
      completionTokens: 1000,
    });
    expect(result.costCents).toBe(0);
    expect(result.matched).toBe(false);
  });

  it("handles zero tokens without crashing", () => {
    const result = computeHiringPlanCostCents({
      provider: "openai",
      model: "gpt-5.4",
      promptTokens: 0,
      completionTokens: 0,
    });
    expect(result.costCents).toBe(0);
  });
});
