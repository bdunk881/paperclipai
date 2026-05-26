import {
  __resetInMemoryStateForTests,
  insertKeySource,
  markThrottled,
  pickKeySource,
  recordSuccess,
  setStatus,
} from "./keySourceStore";

describe("credits key source store (in-memory mode)", () => {
  beforeEach(() => {
    __resetInMemoryStateForTests();
  });

  it("returns null when no key source matches", async () => {
    const picked = await pickKeySource("anthropic");
    expect(picked).toBeNull();
  });

  it("picks the OpenRouter source as a catch-all for any provider", async () => {
    await insertKeySource({
      sourceKind: "openrouter",
      provider: "openrouter",
      label: "or-prod",
      apiKey: "sk-or-test",
      priority: 100,
    });
    const anthropic = await pickKeySource("anthropic");
    const openai = await pickKeySource("openai");
    expect(anthropic?.sourceKind).toBe("openrouter");
    expect(openai?.sourceKind).toBe("openrouter");
    expect(anthropic?.apiKey).toBe("sk-or-test");
  });

  it("prefers a direct provider source over OpenRouter via lower priority", async () => {
    await insertKeySource({
      sourceKind: "openrouter",
      provider: "openrouter",
      label: "or-prod",
      apiKey: "sk-or-test",
      priority: 100,
    });
    await insertKeySource({
      sourceKind: "direct",
      provider: "anthropic",
      label: "anthropic-direct",
      apiKey: "sk-ant-test",
      priority: 10,
    });
    const anthropic = await pickKeySource("anthropic");
    expect(anthropic?.sourceKind).toBe("direct");
    expect(anthropic?.provider).toBe("anthropic");
    expect(anthropic?.apiKey).toBe("sk-ant-test");

    // Non-anthropic still falls through to OpenRouter.
    const openai = await pickKeySource("openai");
    expect(openai?.sourceKind).toBe("openrouter");
  });

  it("skips a throttled key source", async () => {
    const id = await insertKeySource({
      sourceKind: "openrouter",
      provider: "openrouter",
      label: "or-prod",
      apiKey: "sk-or-test",
    });
    await markThrottled(id, 60);
    const picked = await pickKeySource("anthropic");
    expect(picked).toBeNull();
  });

  it("skips a disabled key source", async () => {
    const id = await insertKeySource({
      sourceKind: "openrouter",
      provider: "openrouter",
      label: "or-prod",
      apiKey: "sk-or-test",
    });
    await setStatus(id, "low_balance");
    const picked = await pickKeySource("anthropic");
    expect(picked).toBeNull();
  });

  it("accumulates daily spend on successful calls", async () => {
    const id = await insertKeySource({
      sourceKind: "openrouter",
      provider: "openrouter",
      label: "or-prod",
      apiKey: "sk-or-test",
    });
    await recordSuccess(id, 0.123);
    await recordSuccess(id, 0.456);
    const picked = await pickKeySource("anthropic");
    expect(picked?.currentDaySpendUsd).toBeCloseTo(0.579, 6);
  });
});
