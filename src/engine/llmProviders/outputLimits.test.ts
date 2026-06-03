import {
  PROVIDER_MAX_OUTPUT_TOKENS,
  clampMaxOutputTokens,
} from "./outputLimits";
import { PROVIDER_STREAM_CAPABILITIES } from "./capabilities";

describe("clampMaxOutputTokens (HEL-501)", () => {
  it("raises within a high-cap provider's ceiling (gemini)", () => {
    // The live team-assembly use case: ask for 32768, gemini allows it.
    expect(clampMaxOutputTokens("gemini", 32768)).toBe(32768);
  });

  it("clamps down to a low-cap provider's ceiling (anthropic hard-errors above its max)", () => {
    expect(clampMaxOutputTokens("anthropic", 32768)).toBe(8192);
  });

  it("clamps openai to its completion ceiling", () => {
    expect(clampMaxOutputTokens("openai", 32768)).toBe(16384);
  });

  it("never exceeds a provider's declared cap", () => {
    for (const provider of Object.keys(
      PROVIDER_MAX_OUTPUT_TOKENS,
    ) as Array<keyof typeof PROVIDER_MAX_OUTPUT_TOKENS>) {
      const cap = PROVIDER_MAX_OUTPUT_TOKENS[provider];
      expect(clampMaxOutputTokens(provider, 1_000_000)).toBe(cap);
      expect(clampMaxOutputTokens(provider, 100)).toBe(100);
    }
  });

  it("falls back to the provider ceiling for a non-positive / non-finite desired", () => {
    expect(clampMaxOutputTokens("gemini", 0)).toBe(65536);
    expect(clampMaxOutputTokens("gemini", -5)).toBe(65536);
    expect(clampMaxOutputTokens("gemini", Number.NaN)).toBe(65536);
  });

  it("floors a fractional desired budget", () => {
    expect(clampMaxOutputTokens("gemini", 1024.9)).toBe(1024);
  });

  it("declares a cap for every supported provider (keys match capabilities)", () => {
    // Guards against a provider being added to the union without a cap here.
    expect(Object.keys(PROVIDER_MAX_OUTPUT_TOKENS).sort()).toEqual(
      Object.keys(PROVIDER_STREAM_CAPABILITIES).sort(),
    );
  });
});
