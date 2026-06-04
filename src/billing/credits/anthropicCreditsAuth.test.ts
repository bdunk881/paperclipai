import {
  SUBSCRIPTION_AUTH_ENV_VARS,
  assertAnthropicApiKeyForCredits,
  isAnthropicSubscriptionOAuthKey,
} from "./anthropicCreditsAuth";

describe("isAnthropicSubscriptionOAuthKey", () => {
  it.each([
    ["sk-ant-oat01-abc123", true], // OAuth access token
    ["sk-ant-ort01-def456", true], // OAuth refresh token
    ["  sk-ant-oat01-trimmed  ", true], // surrounding whitespace
    ["SK-ANT-OAT01-UPPER", true], // case-insensitive
    ["sk-ant-api03-realkey", false], // API key — bills prepaid balance
    ["sk-or-v1-openrouterkey", false], // OpenRouter key
    ["sk-test", false], // test fake
    ["", false],
  ])("classifies %j as OAuth=%s", (key, expected) => {
    expect(isAnthropicSubscriptionOAuthKey(key)).toBe(expected);
  });

  it("returns false for null/undefined", () => {
    expect(isAnthropicSubscriptionOAuthKey(null)).toBe(false);
    expect(isAnthropicSubscriptionOAuthKey(undefined)).toBe(false);
  });
});

describe("assertAnthropicApiKeyForCredits (HEL-602)", () => {
  it("REJECTS a subscription-OAuth credential for the Anthropic credits source", () => {
    expect(() =>
      assertAnthropicApiKeyForCredits({
        provider: "anthropic",
        apiKey: "sk-ant-oat01-subscription",
        sourceLabel: "platform-anthropic-direct",
      }),
    ).toThrow(/HEL-602|API key|ANTHROPIC_API_KEY/i);
  });

  it("PASSES an API-key credential for the Anthropic credits source", () => {
    expect(() =>
      assertAnthropicApiKeyForCredits({
        provider: "anthropic",
        apiKey: "sk-ant-api03-prepaid",
      }),
    ).not.toThrow();
  });

  it("names the offending source in the rejection message", () => {
    expect(() =>
      assertAnthropicApiKeyForCredits({
        provider: "anthropic",
        apiKey: "sk-ant-oat01-x",
        sourceLabel: "my-direct-source",
      }),
    ).toThrow(/my-direct-source/);
  });

  it("is a no-op for non-Anthropic providers even with an OAuth-looking key", () => {
    expect(() =>
      assertAnthropicApiKeyForCredits({
        provider: "openai",
        apiKey: "sk-ant-oat01-irrelevant",
      }),
    ).not.toThrow();
  });

  it("is a no-op for an empty or missing key (other layers handle 'no credential')", () => {
    expect(() =>
      assertAnthropicApiKeyForCredits({ provider: "anthropic", apiKey: "" }),
    ).not.toThrow();
    expect(() =>
      assertAnthropicApiKeyForCredits({ provider: "anthropic", apiKey: undefined }),
    ).not.toThrow();
  });
});

describe("SUBSCRIPTION_AUTH_ENV_VARS", () => {
  it("covers the subscription-OAuth token and bearer override env vars", () => {
    expect([...SUBSCRIPTION_AUTH_ENV_VARS]).toEqual([
      "CLAUDE_CODE_OAUTH_TOKEN",
      "ANTHROPIC_AUTH_TOKEN",
    ]);
  });
});
