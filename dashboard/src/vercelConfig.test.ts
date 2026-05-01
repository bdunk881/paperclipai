import vercelConfig from "../vercel.json";

type RewriteRule = {
  source: string;
  destination: string;
  has?: Array<{ type: string; value: string }>;
};

describe("dashboard vercel routing", () => {
  const rewrites = vercelConfig.rewrites as RewriteRule[];
  const headers = vercelConfig.headers as Array<{
    source: string;
    headers: Array<{ key: string; value: string }>;
  }>;

  it("routes staging API traffic to the staging backend", () => {
    expect(rewrites).toContainEqual(
      expect.objectContaining({
        source:
          "/api/:path((?!create-checkout-session$|qa-preview-access$|waitlist-signup$).*)",
        destination: "https://staging-api.helloautoflow.com/api/:path*",
        has: [{ type: "host", value: "staging.app.helloautoflow.com" }],
      })
    );
  });

  it("preserves only the frontend-owned serverless endpoints from the backend rewrite", () => {
    const apiRewrite = rewrites.find(
      (rule) => rule.destination === "https://api.helloautoflow.com/api/:path*"
    );

    expect(apiRewrite).toBeDefined();
    expect(apiRewrite?.source).toContain("create-checkout-session");
    expect(apiRewrite?.source).toContain("qa-preview-access");
    expect(apiRewrite?.source).toContain("waitlist-signup");
    expect(apiRewrite?.source).not.toContain("auth/native");
    expect(apiRewrite?.source).not.toContain("billing/checkout");
  });

  it("allows both production and staging APIs in the dashboard CSP", () => {
    const cspHeader = headers
      .flatMap((entry) => entry.headers)
      .find((header) => header.key === "Content-Security-Policy");

    expect(cspHeader).toBeDefined();
    expect(cspHeader?.value).toContain("https://api.helloautoflow.com");
    expect(cspHeader?.value).toContain("https://staging-api.helloautoflow.com");
  });
});
