import {
  buildIntegrationLogoUrl,
  buildLogoDevUrl,
  resolveIntegrationLogoDomain,
} from "@autoflow/logo-dev";

describe("logoDev", () => {
  const token = "pk_test_key";

  it("resolves known integration domains", () => {
    expect(resolveIntegrationLogoDomain("slack")).toBe("slack.com");
    expect(resolveIntegrationLogoDomain("STRIPE")).toBe("stripe.com");
    expect(resolveIntegrationLogoDomain("attio")).toBe("attio.com");
    expect(resolveIntegrationLogoDomain("unknown-tool")).toBeUndefined();
  });

  it("builds domain-based logo URLs", () => {
    const url = buildLogoDevUrl({
      name: "Stripe",
      domain: "stripe.com",
      token,
      size: 64,
    });
    expect(url).toBe(
      "https://img.logo.dev/stripe.com?token=pk_test_key&size=64&format=png&theme=auto&fallback=404",
    );
  });

  it("builds name-based logo URLs when domain is missing", () => {
    const url = buildLogoDevUrl({
      name: "Sweet Green",
      token,
    });
    expect(url).toContain("https://img.logo.dev/name/Sweet%20Green?");
    expect(url).toContain("token=pk_test_key");
  });

  it("builds integration logo URLs from catalog ids", () => {
    const url = buildIntegrationLogoUrl("linear", "Linear", token, 32);
    expect(url).toBe(
      "https://img.logo.dev/linear.app?token=pk_test_key&size=32&format=png&theme=auto&fallback=404",
    );
  });

  it("threads explicit logo theme variants", () => {
    const url = buildIntegrationLogoUrl("github", "GitHub", token, 32, "dark");
    expect(url).toBe(
      "https://img.logo.dev/github.com?token=pk_test_key&size=32&format=png&theme=dark&fallback=404",
    );
  });

  it("returns null when token is empty", () => {
    expect(buildIntegrationLogoUrl("slack", "Slack", "", 32)).toBeNull();
  });
});
