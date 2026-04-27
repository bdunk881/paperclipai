describe("socialAuthStrategies", () => {
  const originalEnv = process.env;

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
