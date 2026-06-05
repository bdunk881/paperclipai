import {
  ESTIMATED_TOKENS_PER_AGENT_FILL,
  TARGET_FILL_JSON_TOKENS,
  computeFillBatchSize,
  splitRolesIntoFillBatches,
  recommendedFillCallMaxTokens,
  recommendedSkeletonMaxTokens,
} from "./teamAssemblyBudget";
import { clampMaxOutputTokens } from "../engine/llmProviders/outputLimits";

describe("teamAssemblyBudget (HEL-501 / chunked generation PR1)", () => {
  describe("computeFillBatchSize", () => {
    it("targets ~TARGET_FILL_JSON_TOKENS worth of agents on a high-cap provider", () => {
      // 4000 / 320 = 12.5 -> 12 agents per fill call on gemini.
      expect(computeFillBatchSize("gemini")).toBe(
        Math.floor(TARGET_FILL_JSON_TOKENS / ESTIMATED_TOKENS_PER_AGENT_FILL),
      );
      expect(computeFillBatchSize("gemini")).toBe(12);
    });

    it("never lets a low-cap provider exceed its safe usable budget (cohere)", () => {
      // cohere cap 4096 * 0.75 reserve = 3072 usable; 3072 / 320 = 9.
      expect(computeFillBatchSize("cohere")).toBe(9);
    });

    it("always returns at least 1", () => {
      expect(
        computeFillBatchSize("cohere", { estimatedTokensPerAgent: 100_000 }),
      ).toBe(1);
    });

    it("scales inversely with the per-agent token estimate", () => {
      const small = computeFillBatchSize("gemini", { estimatedTokensPerAgent: 200 });
      const large = computeFillBatchSize("gemini", { estimatedTokensPerAgent: 1000 });
      expect(small).toBeGreaterThan(large);
      expect(large).toBe(4); // 4000 / 1000
    });

    it("honors a reserveFraction override that bites into a high cap", () => {
      // gemini 65536 * 0.05 = 3276 usable < 4000 target; 3276 / 320 = 10.
      expect(computeFillBatchSize("gemini", { reserveFraction: 0.05 })).toBe(10);
    });

    // HEL-639: slow reasoning BYOK providers (OpenAI gpt-5/o-series, Anthropic
    // opus) are capped below the budget-derived size so a single fill call
    // stays under the 120s per-call timeout; the roles spread across more
    // concurrent fills instead.
    it("caps OpenAI at the latency ceiling (budget would allow 12)", () => {
      // openai 16384 * 0.75 = 12288 usable; min(4000, 12288)/320 = 12 by
      // budget, capped to 6 for latency.
      expect(computeFillBatchSize("openai")).toBe(6);
    });

    it("caps Anthropic at the latency ceiling (budget would allow 12)", () => {
      // anthropic 8192 * 0.75 = 6144 usable; min(4000, 6144)/320 = 12 by
      // budget, capped to 6 for latency.
      expect(computeFillBatchSize("anthropic")).toBe(6);
    });

    it("leaves a fast provider (gemini) uncapped", () => {
      expect(computeFillBatchSize("gemini")).toBe(12);
    });

    it("only LOWERS the batch — never raises a sub-cap budget size", () => {
      // openai budget: 4000 / 1000 = 4, which is already < the cap of 6, so the
      // cap is a no-op and the smaller budget size wins.
      expect(
        computeFillBatchSize("openai", { estimatedTokensPerAgent: 1000 }),
      ).toBe(4);
    });
  });

  describe("splitRolesIntoFillBatches", () => {
    const roleKeys = (n: number): string[] =>
      Array.from({ length: n }, (_, i) => `role-${i + 1}`);

    it("splits a 15-role plan into 12 + 3 on gemini", () => {
      const batches = splitRolesIntoFillBatches(roleKeys(15), "gemini");
      expect(batches.map((b) => b.length)).toEqual([12, 3]);
    });

    it("preserves order and covers every role exactly once", () => {
      const roles = roleKeys(15);
      const batches = splitRolesIntoFillBatches(roles, "gemini");
      expect(batches.flat()).toEqual(roles);
    });

    it("returns a single batch when roles fit", () => {
      expect(splitRolesIntoFillBatches(roleKeys(8), "gemini")).toHaveLength(1);
    });

    it("returns no batches for an empty role list", () => {
      expect(splitRolesIntoFillBatches([], "gemini")).toEqual([]);
    });
  });

  describe("recommendedFillCallMaxTokens", () => {
    it("adds generous thinking headroom to the batch JSON (gemini)", () => {
      // 12 * 320 = 3840 JSON + 24000 thinking headroom = 27840 requested.
      expect(recommendedFillCallMaxTokens("gemini", 12)).toBe(27840);
    });

    it("clamps to the provider ceiling when a batch would over-request", () => {
      expect(recommendedFillCallMaxTokens("anthropic", 100)).toBe(
        clampMaxOutputTokens("anthropic", 1_000_000),
      );
      expect(recommendedFillCallMaxTokens("anthropic", 100)).toBe(8192);
    });

    it("handles a single-role batch", () => {
      expect(recommendedFillCallMaxTokens("gemini", 1)).toBe(24320); // 320 + 24000
    });
  });

  describe("recommendedSkeletonMaxTokens", () => {
    it("budgets a small team's skeleton with thinking headroom", () => {
      // (12*45 + 900) = 1440 JSON + 24000 headroom = 25440.
      expect(recommendedSkeletonMaxTokens("gemini", 12)).toBe(25440);
    });

    it("scales up for a large team but stays under the provider cap", () => {
      // anthropic (now a reasoning provider): (200*45 + 900) + 24000 headroom
      // far exceeds the 8192 ceiling, so it clamps.
      expect(recommendedSkeletonMaxTokens("anthropic", 200)).toBe(8192);
    });

    it("scales the skeleton budget with team size on a high-cap provider", () => {
      // gemini, 40 roles: (40*45 + 900) = 2700 JSON + 24000 = 26700.
      expect(recommendedSkeletonMaxTokens("gemini", 40)).toBe(26700);
    });

    // HEL-652: anthropic (opus-4-8) + openai (gpt-5) are reasoning providers, so a
    // larger-team skeleton gets the full reasoning headroom — clamped to the
    // provider ceiling — instead of the old non-reasoning 12*45+900+2048=3488 that
    // truncated a live 16-role Opus skeleton mid-JSON.
    it("gives anthropic + openai the full ceiling for a large-team skeleton", () => {
      expect(recommendedSkeletonMaxTokens("anthropic", 16)).toBe(
        clampMaxOutputTokens("anthropic", 1_000_000),
      );
      expect(recommendedSkeletonMaxTokens("anthropic", 16)).toBe(8192);
      expect(recommendedSkeletonMaxTokens("openai", 16)).toBe(
        clampMaxOutputTokens("openai", 1_000_000),
      );
      // Far above the old non-reasoning 3488 that truncated.
      expect(recommendedSkeletonMaxTokens("openai", 16)).toBeGreaterThan(3488);
    });
  });
});
