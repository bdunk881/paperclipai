import vercelConfig from "../vercel.json";

type RewriteRule = {
  source: string;
  destination: string;
  has?: Array<{ type: string; value: string }>;
};

describe("dashboard vercel routing", () => {
  const rewrites = vercelConfig.rewrites as RewriteRule[];

  it("routes staging API traffic to the staging backend", () => {
    expect(rewrites).toContainEqual(
      expect.objectContaining({
        source:
          "/api/:path((?!auth/native(?:/.*)?$|billing/checkout$|create-checkout-session$|qa-preview-access$|waitlist-signup$).*)",
        destination: "https://staging-api.helloautoflow.com/api/:path*",
        has: [{ type: "host", value: "staging.app.helloautoflow.com" }],
      })
    );
  });

  it("preserves frontend-owned serverless endpoints from the backend rewrite", () => {
    const apiRewrite = rewrites.find(
      (rule) => rule.destination === "https://api.helloautoflow.com/api/:path*"
    );

    expect(apiRewrite).toBeDefined();
    expect(apiRewrite?.source).toContain("auth/native");
    expect(apiRewrite?.source).toContain("billing/checkout");
    expect(apiRewrite?.source).toContain("create-checkout-session");
    expect(apiRewrite?.source).toContain("qa-preview-access");
    expect(apiRewrite?.source).toContain("waitlist-signup");
  });
});
