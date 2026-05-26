import {
  actualCallCredits,
  applyMarkup,
  computeWholesaleUsd,
  estimateWorstCaseCredits,
  usdToCredits,
} from "./costCalculator";
import { DEFAULT_MODEL_RATES, getDefaultModelRate } from "./modelPricing";

describe("credits cost calculator", () => {
  it("seeds the rate card with the launch tier defaults", () => {
    const sonnet = getDefaultModelRate("anthropic", "claude-sonnet-4-6");
    expect(sonnet).not.toBeNull();
    expect(sonnet?.inputUsdPerMillion).toBe(3.0);
    expect(sonnet?.outputUsdPerMillion).toBe(15.0);
    expect(sonnet?.markupMultiplier).toBe(1.5);
  });

  it("computes uncached wholesale cost as a simple per-million rate", () => {
    const sonnet = getDefaultModelRate("anthropic", "claude-sonnet-4-6")!;
    // 1,000 input tokens at $3/M and 500 output at $15/M:
    //  input  = 1000 / 1e6 * 3   = 0.003
    //  output = 500  / 1e6 * 15  = 0.0075
    //  total                     = 0.0105
    const cost = computeWholesaleUsd(sonnet, { promptTokens: 1000, completionTokens: 500 });
    expect(cost).toBeCloseTo(0.0105, 6);
  });

  it("applies cache discount to the cached portion of prompt tokens", () => {
    const sonnet = getDefaultModelRate("anthropic", "claude-sonnet-4-6")!;
    // 1,000 prompt tokens, 800 of them cached. Cached rate is $0.30/M
    // (vs $3.00/M uncached); 200 uncached at the full rate, 800 cached.
    //  uncached = 200 / 1e6 * 3.00 = 0.0006
    //  cached   = 800 / 1e6 * 0.30 = 0.00024
    //  output   = 0 / 1e6 * 15     = 0
    //  total                       = 0.00084
    const cost = computeWholesaleUsd(sonnet, {
      promptTokens: 1000,
      completionTokens: 0,
      cachedPromptTokens: 800,
    });
    expect(cost).toBeCloseTo(0.00084, 6);
  });

  it("applies cache-write surcharge for Anthropic", () => {
    const sonnet = getDefaultModelRate("anthropic", "claude-sonnet-4-6")!;
    // 1,000 prompt tokens, all cache-write at $3.75/M.
    const cost = computeWholesaleUsd(sonnet, {
      promptTokens: 1000,
      completionTokens: 0,
      cachedCreationTokens: 1000,
    });
    expect(cost).toBeCloseTo(0.00375, 6);
  });

  it("rounds credits UP from USD so we never under-bill", () => {
    expect(usdToCredits(0)).toBe(0n);
    expect(usdToCredits(0.0001)).toBe(1n);
    expect(usdToCredits(0.00015)).toBe(2n);
    expect(usdToCredits(0.00010001)).toBe(2n);
  });

  it("rejects negative USD inputs to credit conversion (defensive)", () => {
    expect(usdToCredits(-1)).toBe(0n);
    expect(usdToCredits(Number.NaN)).toBe(0n);
  });

  it("applies the markup multiplier on wholesale to compute retail", () => {
    expect(applyMarkup(2.0, 1.5)).toBe(3.0);
  });

  it("estimates worst-case credits using the max output budget", async () => {
    const estimate = await estimateWorstCaseCredits({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      promptTokens: 1000,
      maxOutputTokens: 1000,
    });
    expect(estimate).not.toBeNull();
    // wholesale = (1000/1e6 * 3) + (1000/1e6 * 15) = 0.018
    // retail = 0.018 * 1.5 = 0.027
    // credits = ceil(0.027 / 0.0001) = 270
    expect(estimate?.wholesaleUsd).toBeCloseTo(0.018, 6);
    expect(estimate?.retailUsd).toBeCloseTo(0.027, 6);
    expect(estimate?.credits).toBe(270n);
  });

  it("returns null pricing for an unknown (provider, model)", async () => {
    const result = await estimateWorstCaseCredits({
      provider: "anthropic",
      model: "claude-glow-9000",
      promptTokens: 100,
      maxOutputTokens: 100,
    });
    expect(result).toBeNull();
  });

  it("actualCallCredits matches the wholesale path with provided usage", async () => {
    const result = await actualCallCredits({
      provider: "openai",
      model: "gpt-5.4",
      usage: { promptTokens: 2000, completionTokens: 500 },
    });
    // gpt-5.4 input $2.50/M, output $15.00/M:
    //  wholesale = (2000/1e6 * 2.5) + (500/1e6 * 15) = 0.005 + 0.0075 = 0.0125
    //  retail = 0.0125 * 1.5 = 0.01875
    //  credits = ceil(0.01875 / 0.0001) = 188
    expect(result?.wholesaleUsd).toBeCloseTo(0.0125, 6);
    expect(result?.retailUsd).toBeCloseTo(0.01875, 6);
    expect(result?.credits).toBe(188n);
  });

  it("rate card covers the launch tier targets across all 5 providers", () => {
    const required: Array<[string, string]> = [
      ["anthropic", "claude-opus-4-7"],
      ["anthropic", "claude-sonnet-4-6"],
      ["anthropic", "claude-haiku-4-5"],
      ["openai", "gpt-5.5"],
      ["openai", "gpt-5.4"],
      ["gemini", "gemini-3.5-flash"],
      ["deepseek", "deepseek-v4-pro"],
      ["deepseek", "deepseek-v4-flash"],
      ["groq", "llama-3.3-70b-versatile"],
      ["groq", "llama-3.1-8b-instant"],
    ];
    for (const [provider, model] of required) {
      const found = DEFAULT_MODEL_RATES.find((r) => r.provider === provider && r.model === model);
      expect(found).toBeDefined();
    }
  });
});
