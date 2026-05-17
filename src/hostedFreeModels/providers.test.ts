/**
 * PR B.1 unit tests for the hosted free model catalog + resolvers.
 */

import {
  DEFAULT_HOSTED_FREE_PROVIDER_ID,
  HOSTED_FREE_PROVIDERS,
  buildResolvedFromHostedFree,
  getDefaultHostedFreeProvider,
  getHostedFreeProviderById,
  resolveHostedFreeApiKey,
} from "./providers";

describe("hostedFreeModels/providers", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Isolate process.env so other suites' API keys don't leak in.
    process.env = { ...originalEnv };
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENCODE_ZEN_API_KEY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("catalog shape", () => {
    it("has three tiers ordered 1 → 2 → 3", () => {
      expect(HOSTED_FREE_PROVIDERS).toHaveLength(3);
      expect(HOSTED_FREE_PROVIDERS.map((p) => p.tier)).toEqual([1, 2, 3]);
    });

    it("default is Tier 2 (Groq 8B), not Tier 1 (Big Pickle) — Tier 1 trains on prompts", () => {
      expect(DEFAULT_HOSTED_FREE_PROVIDER_ID).toBe("groq_llama_31_8b");
      const def = getHostedFreeProviderById(DEFAULT_HOSTED_FREE_PROVIDER_ID);
      expect(def?.tier).toBe(2);
      expect(def?.warnings).toEqual([]);
    });

    it("Tier 1 (Big Pickle) carries the training + beta warnings", () => {
      const tier1 = HOSTED_FREE_PROVIDERS.find((p) => p.tier === 1);
      expect(tier1).toBeDefined();
      expect(tier1!.id).toBe("opencode_zen_big_pickle");
      expect(tier1!.warnings.some((w) => /train/i.test(w))).toBe(true);
      expect(tier1!.warnings.some((w) => /beta/i.test(w))).toBe(true);
    });

    it("each provider pins a fixed modelId so the engine's tier classifier doesn't pick a wrong model", () => {
      for (const p of HOSTED_FREE_PROVIDERS) {
        expect(typeof p.modelId).toBe("string");
        expect(p.modelId.length).toBeGreaterThan(0);
      }
    });
  });

  describe("resolveHostedFreeApiKey", () => {
    it("returns null when the env var is unset", () => {
      const tier2 = getHostedFreeProviderById("groq_llama_31_8b")!;
      expect(resolveHostedFreeApiKey(tier2)).toBeNull();
    });

    it("returns null when the env var is empty / whitespace", () => {
      process.env.GROQ_API_KEY = "   ";
      const tier2 = getHostedFreeProviderById("groq_llama_31_8b")!;
      expect(resolveHostedFreeApiKey(tier2)).toBeNull();
    });

    it("returns the trimmed value when set", () => {
      process.env.GROQ_API_KEY = "  gsk-test-1234  ";
      const tier2 = getHostedFreeProviderById("groq_llama_31_8b")!;
      expect(resolveHostedFreeApiKey(tier2)).toBe("gsk-test-1234");
    });
  });

  describe("getDefaultHostedFreeProvider", () => {
    it("returns null when the default's env var isn't configured", () => {
      // No GROQ_API_KEY set in beforeEach.
      expect(getDefaultHostedFreeProvider()).toBeNull();
    });

    it("returns the default provider when its key IS configured", () => {
      process.env.GROQ_API_KEY = "gsk-test-key";
      const def = getDefaultHostedFreeProvider();
      expect(def?.id).toBe(DEFAULT_HOSTED_FREE_PROVIDER_ID);
    });
  });

  describe("buildResolvedFromHostedFree", () => {
    it("synthesizes a DecryptedLLMConfig-shaped object that the engine can pass to getProvider()", () => {
      const tier2 = getHostedFreeProviderById("groq_llama_31_8b")!;
      const resolved = buildResolvedFromHostedFree(tier2, "gsk-fake");
      expect(resolved.config.provider).toBe("groq");
      expect(resolved.config.model).toBe("llama-3.1-8b-instant");
      expect(resolved.apiKey).toBe("gsk-fake");
      expect(resolved.credentials.apiKey).toBe("gsk-fake");
      expect(resolved.config.id).toBe("hosted-free:groq_llama_31_8b");
    });
  });
});
