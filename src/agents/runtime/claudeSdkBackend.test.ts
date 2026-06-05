import { buildAnthropicSdkEnv } from "./claudeSdkBackend";

const API_KEY = "sk-ant-api03-prepaid";

describe("buildAnthropicSdkEnv (HEL-602)", () => {
  it("sets ANTHROPIC_API_KEY to the binding key for API-key billing", () => {
    const env = buildAnthropicSdkEnv({ provider: "anthropic", apiKey: API_KEY }, {});
    expect(env.ANTHROPIC_API_KEY).toBe(API_KEY);
  });

  it("strips ambient subscription-OAuth / bearer env vars so they can't override API-key billing", () => {
    const base = {
      CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-subscription",
      ANTHROPIC_AUTH_TOKEN: "bearer-override",
      PATH: "/usr/bin",
    };
    const env = buildAnthropicSdkEnv({ provider: "anthropic", apiKey: API_KEY }, base);
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBe(API_KEY);
  });

  it("preserves unrelated env vars", () => {
    const env = buildAnthropicSdkEnv(
      { provider: "anthropic", apiKey: API_KEY },
      { PATH: "/usr/bin", HOME: "/home/app" },
    );
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/app");
  });

  it("does not mutate the supplied base env", () => {
    const base = { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-x" };
    buildAnthropicSdkEnv({ provider: "anthropic", apiKey: API_KEY }, base);
    expect(base.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-x");
  });

  it("rejects an OAuth token wired in as the Anthropic binding key", () => {
    expect(() =>
      buildAnthropicSdkEnv(
        { provider: "anthropic", apiKey: "sk-ant-oat01-subscription" },
        {},
      ),
    ).toThrow(/HEL-602|API key|ANTHROPIC_API_KEY/i);
  });
});
