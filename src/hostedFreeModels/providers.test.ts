/**
 * Unit tests for the hosted free model catalog + resolvers.
 * HEL-605: OpenCode Zen is the sole hosted-free model (Groq dropped).
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
    delete process.env.OPENCODE_ZEN_API_KEY;
    delete process.env.GROQ_API_KEY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("catalog shape", () => {
    it("offers a single hosted-free model: OpenCode Zen (HEL-605 dropped Groq)", () => {
      expect(HOSTED_FREE_PROVIDERS).toHaveLength(1);
      expect(HOSTED_FREE_PROVIDERS[0]!.id).toBe("opencode_zen_big_pickle");
      expect(HOSTED_FREE_PROVIDERS[0]!.provider).toBe("opencode_zen");
      expect(HOSTED_FREE_PROVIDERS.some((p) => p.provider === "groq")).toBe(false);
    });

    it("defaults to OpenCode Zen Big Pickle (the sole free model)", () => {
      expect(DEFAULT_HOSTED_FREE_PROVIDER_ID).toBe("opencode_zen_big_pickle");
      const def = getHostedFreeProviderById(DEFAULT_HOSTED_FREE_PROVIDER_ID);
      expect(def?.provider).toBe("opencode_zen");
    });

    it("Big Pickle carries the training + beta warnings", () => {
      const def = getHostedFreeProviderById("opencode_zen_big_pickle")!;
      expect(def.warnings.some((w) => /train/i.test(w))).toBe(true);
      expect(def.warnings.some((w) => /beta/i.test(w))).toBe(true);
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
      const def = getHostedFreeProviderById("opencode_zen_big_pickle")!;
      expect(resolveHostedFreeApiKey(def)).toBeNull();
    });

    it("returns null when the env var is empty / whitespace", () => {
      process.env.OPENCODE_ZEN_API_KEY = "   ";
      const def = getHostedFreeProviderById("opencode_zen_big_pickle")!;
      expect(resolveHostedFreeApiKey(def)).toBeNull();
    });

    it("returns the trimmed value when set", () => {
      process.env.OPENCODE_ZEN_API_KEY = "  oc-test-1234  ";
      const def = getHostedFreeProviderById("opencode_zen_big_pickle")!;
      expect(resolveHostedFreeApiKey(def)).toBe("oc-test-1234");
    });
  });

  describe("getDefaultHostedFreeProvider", () => {
    it("returns null when the default's env var isn't configured", () => {
      // No OPENCODE_ZEN_API_KEY set in beforeEach.
      expect(getDefaultHostedFreeProvider()).toBeNull();
    });

    it("returns the default provider when its key IS configured", () => {
      process.env.OPENCODE_ZEN_API_KEY = "oc-test-key";
      const def = getDefaultHostedFreeProvider();
      expect(def?.id).toBe(DEFAULT_HOSTED_FREE_PROVIDER_ID);
    });
  });

  describe("buildResolvedFromHostedFree", () => {
    it("synthesizes a DecryptedLLMConfig-shaped object that the engine can pass to getProvider()", () => {
      const def = getHostedFreeProviderById("opencode_zen_big_pickle")!;
      const resolved = buildResolvedFromHostedFree(def, "oc-fake");
      expect(resolved.config.provider).toBe("opencode_zen");
      expect(resolved.config.model).toBe("big-pickle");
      expect(resolved.apiKey).toBe("oc-fake");
      expect(resolved.credentials.apiKey).toBe("oc-fake");
      expect(resolved.config.id).toBe("hosted-free:opencode_zen_big_pickle");
    });
  });
});
