const originalEnv = process.env;

describe("social auth callback URL normalization", () => {
  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  it("rejects localhost http callbacks in production by default", () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
    };

    const { normalizeSocialAuthCallbackUrl } = require("./socialAuthStrategies") as typeof import("./socialAuthStrategies");

    expect(normalizeSocialAuthCallbackUrl("http://localhost:3000/api/auth/social/google/callback")).toBeNull();
  });

  it("allows localhost http callbacks outside production", () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "development",
    };

    const { normalizeSocialAuthCallbackUrl } = require("./socialAuthStrategies") as typeof import("./socialAuthStrategies");

    expect(normalizeSocialAuthCallbackUrl("http://localhost:3000/api/auth/social/google/callback")).toBe(
      "http://localhost:3000/api/auth/social/google/callback"
    );
  });

  it("allows localhost http callbacks in production only with the explicit flag", () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      SOCIAL_AUTH_ALLOW_HTTP_CALLBACK: "true",
    };

    const { normalizeSocialAuthCallbackUrl } = require("./socialAuthStrategies") as typeof import("./socialAuthStrategies");

    expect(normalizeSocialAuthCallbackUrl("http://localhost:3000/api/auth/social/google/callback")).toBe(
      "http://localhost:3000/api/auth/social/google/callback"
    );
  });
});
