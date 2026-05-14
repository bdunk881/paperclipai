/**
 * Tests for the tier router resolver + default-matrix inference (HEL-81).
 *
 * These tests run against the in-memory fallback path so they don't need a
 * live Postgres. Per HEL-80, AUTOFLOW_ALLOW_INMEMORY is set automatically
 * via jest.env.cjs.
 */

import {
  __resetInMemoryStateForTests,
  getDefaultTierMatrix,
  resolveTier,
  setAgentTierOverrides,
  setWorkspaceTierMatrix,
  TIER_KEYS,
} from "./tierRouter";

describe("tierRouter — default matrix inference", () => {
  it("returns empty matrix when no providers connected", () => {
    expect(getDefaultTierMatrix([])).toEqual({});
  });

  it("uses Anthropic models when only Anthropic is connected", () => {
    const matrix = getDefaultTierMatrix(["anthropic"]);
    expect(matrix.small?.provider).toBe("anthropic");
    expect(matrix.small?.model).toMatch(/haiku/);
    expect(matrix.medium?.model).toMatch(/sonnet/);
    expect(matrix.large?.model).toMatch(/opus/);
    // Embeddings not available on Anthropic by default — should be undefined
    // unless a future provider catalog entry adds it.
    expect(matrix.embeddings).toBeUndefined();
  });

  it("uses OpenAI models when only OpenAI is connected, including embeddings", () => {
    const matrix = getDefaultTierMatrix(["openai"]);
    expect(matrix.small?.provider).toBe("openai");
    expect(matrix.small?.model).toMatch(/^gpt-4o-mini$/);
    expect(matrix.embeddings?.provider).toBe("openai");
    expect(matrix.embeddings?.model).toBe("text-embedding-3-small");
    expect(matrix.embeddings?.version).toBe(1);
  });

  it("mixes providers: cheapest small, Anthropic medium/large, OpenAI embeddings", () => {
    const matrix = getDefaultTierMatrix(["openai", "anthropic"]);
    // small: OpenAI gpt-4o-mini is cheaper than Anthropic Haiku
    expect(matrix.small?.provider).toBe("openai");
    // medium: Anthropic Sonnet wins by priority
    expect(matrix.medium?.provider).toBe("anthropic");
    expect(matrix.medium?.model).toMatch(/sonnet/);
    // large: Anthropic Opus wins by priority
    expect(matrix.large?.provider).toBe("anthropic");
    expect(matrix.large?.model).toMatch(/opus/);
    // embeddings: OpenAI text-embedding-3-small
    expect(matrix.embeddings?.provider).toBe("openai");
  });

  it("picks Gemini Flash as cheapest small when Gemini is connected", () => {
    const matrix = getDefaultTierMatrix(["anthropic", "gemini"]);
    expect(matrix.small?.provider).toBe("gemini");
    expect(matrix.small?.model).toMatch(/flash/);
  });

  it("declares vision tier from first provider that supports it", () => {
    const matrix = getDefaultTierMatrix(["openai"]);
    expect(matrix.vision?.provider).toBe("openai");
  });
});

describe("tierRouter — resolveTier resolution order (HEL-81)", () => {
  const workspaceId = "11111111-1111-1111-1111-111111111111";
  const agentId = "22222222-2222-2222-2222-222222222222";

  beforeEach(() => {
    __resetInMemoryStateForTests();
  });

  it("returns null when no matrix, no override, no connected providers", async () => {
    const result = await resolveTier({ workspaceId, tier: "small" });
    expect(result).toBeNull();
  });

  it("returns inferred default when only connectedProviders supplied", async () => {
    const result = await resolveTier({
      workspaceId,
      tier: "small",
      connectedProviders: ["openai"],
    });
    expect(result?.source).toBe("inferred_default");
    expect(result?.binding.provider).toBe("openai");
  });

  it("prefers the workspace matrix over inferred defaults", async () => {
    await setWorkspaceTierMatrix(workspaceId, {
      small: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
    });

    const result = await resolveTier({
      workspaceId,
      tier: "small",
      connectedProviders: ["openai"],
    });
    expect(result?.source).toBe("workspace_matrix");
    expect(result?.binding.provider).toBe("anthropic");
  });

  it("prefers the agent override over the workspace matrix", async () => {
    await setWorkspaceTierMatrix(workspaceId, {
      large: { provider: "anthropic", model: "claude-opus-4-6" },
    });
    await setAgentTierOverrides(agentId, {
      large: { provider: "openai", model: "gpt-4o" },
    });

    const result = await resolveTier({ workspaceId, tier: "large", agentId });
    expect(result?.source).toBe("agent_override");
    expect(result?.binding.provider).toBe("openai");
    expect(result?.binding.model).toBe("gpt-4o");
  });

  it("falls back to workspace matrix when agent has no override for the requested tier", async () => {
    await setWorkspaceTierMatrix(workspaceId, {
      medium: { provider: "anthropic", model: "claude-sonnet-4-6" },
    });
    await setAgentTierOverrides(agentId, {
      // override only for large, not for medium
      large: { provider: "openai", model: "gpt-4o" },
    });

    const result = await resolveTier({ workspaceId, tier: "medium", agentId });
    expect(result?.source).toBe("workspace_matrix");
    expect(result?.binding.provider).toBe("anthropic");
  });

  it("resolves each of the 5 tier keys without crashing", async () => {
    await setWorkspaceTierMatrix(workspaceId, {
      small: { provider: "openai", model: "gpt-4o-mini" },
      medium: { provider: "openai", model: "gpt-4o" },
      large: { provider: "openai", model: "gpt-4o" },
      embeddings: { provider: "openai", model: "text-embedding-3-small", version: 1 },
      vision: { provider: "openai", model: "gpt-4o" },
    });

    for (const tier of TIER_KEYS) {
      const result = await resolveTier({ workspaceId, tier });
      expect(result?.binding.provider).toBe("openai");
    }
  });
});
