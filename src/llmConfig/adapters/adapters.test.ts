/**
 * Smoke tests for the provider adapter registry (HEL-82).
 *
 * Full wire-format integration tests (mocking the Anthropic + OpenAI HTTP
 * surfaces) land alongside the rest of the cross-model agent runtime in
 * HEL-88. This file proves the registry binds + that the two v1 adapters
 * instantiate cleanly.
 */

import { getProviderAdapter, getSupportedAdapterProviders } from "./index";

describe("provider adapter registry (HEL-82)", () => {
  it("returns the Anthropic adapter for provider='anthropic'", () => {
    const adapter = getProviderAdapter("anthropic");
    expect(adapter.provider).toBe("anthropic");
    expect(typeof adapter.invoke).toBe("function");
  });

  it("returns the OpenAI adapter for provider='openai'", () => {
    const adapter = getProviderAdapter("openai");
    expect(adapter.provider).toBe("openai");
    expect(typeof adapter.invoke).toBe("function");
  });

  it("throws a clear error for unimplemented providers (e.g., gemini in v1)", () => {
    expect(() => getProviderAdapter("gemini")).toThrow(/not implemented.*v1/);
  });

  it("lists the v1 supported providers", () => {
    const supported = getSupportedAdapterProviders().sort();
    expect(supported).toEqual(["anthropic", "openai"]);
  });

  it("Anthropic adapter refuses to invoke without an API key", async () => {
    const adapter = getProviderAdapter("anthropic");
    await expect(
      adapter.invoke({
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/API key is required/);
  });

  it("OpenAI adapter refuses to invoke without an API key", async () => {
    const adapter = getProviderAdapter("openai");
    await expect(
      adapter.invoke({
        provider: "openai",
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/API key is required/);
  });
});
