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
    it("grosses up the batch's JSON by the reasoning reserve (gemini)", () => {
      // 12 * 320 = 3840 JSON; / 0.5 reserve = 7680 requested.
      expect(recommendedFillCallMaxTokens("gemini", 12)).toBe(7680);
    });

    it("clamps to the provider ceiling when a batch would over-request", () => {
      expect(recommendedFillCallMaxTokens("anthropic", 100)).toBe(
        clampMaxOutputTokens("anthropic", 1_000_000),
      );
      expect(recommendedFillCallMaxTokens("anthropic", 100)).toBe(8192);
    });

    it("handles a single-role batch", () => {
      expect(recommendedFillCallMaxTokens("gemini", 1)).toBe(640); // 320 / 0.5
    });
  });

  describe("recommendedSkeletonMaxTokens", () => {
    it("floors a small team's skeleton budget", () => {
      expect(recommendedSkeletonMaxTokens("gemini", 12)).toBe(4096);
    });

    it("scales up for a large team but stays under the provider cap", () => {
      // anthropic: (200*45 + 900) / 0.75 = 13200 desired, clamped to 8192.
      expect(recommendedSkeletonMaxTokens("anthropic", 200)).toBe(8192);
    });

    it("grows past the floor for a mid-size team on a high-cap provider", () => {
      // gemini, 40 roles: (40*45 + 900) / 0.5 = 5400 > 4096 floor.
      expect(recommendedSkeletonMaxTokens("gemini", 40)).toBe(5400);
    });
  });
});
