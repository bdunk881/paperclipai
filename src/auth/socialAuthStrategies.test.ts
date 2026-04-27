const originalEnv = process.env;

describe("social auth callback URL normalization", () => {
  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
    jest.restoreAllMocks();
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

describe("socialAuthStrategies", () => {
  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
    jest.restoreAllMocks();
    jest.unmock("passport");
    jest.unmock("passport-google-oauth20");
  });

  it("captures google strategy initialization failures without throwing at module load", () => {
    process.env = {
      ...originalEnv,
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      SOCIAL_AUTH_CALLBACK_BASE_URL: "https://api.autoflow.test/api/auth/social",
    };
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    jest.doMock("passport", () => ({
      __esModule: true,
      default: {
        use: jest.fn(),
      },
    }));
    jest.doMock("passport-google-oauth20", () => {
      throw new Error("Cannot find module 'passport-google-oauth20'");
    });

    const strategies = require("./socialAuthStrategies") as typeof import("./socialAuthStrategies");

    expect(() => strategies.configureSocialAuthStrategies()).not.toThrow();
    expect(strategies.isSocialAuthProviderEnabled("google")).toBe(false);
    expect(strategies.getSocialAuthConfigurationError("google")).toBe(
      "Cannot find module 'passport-google-oauth20'"
    );
  });
});
