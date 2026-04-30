import request from "supertest";
import {
  createSocialAuthNonce,
  createSocialAuthState,
  SOCIAL_AUTH_NONCE_COOKIE_NAME,
} from "./appAuthTokens";

const originalEnv = process.env;

type PassportAuthenticate = (
  strategy: string,
  options?: Record<string, unknown>,
  callback?: (error: Error | null, user?: unknown) => void
) => import("express").RequestHandler;

function loadApp(authenticateImpl: PassportAuthenticate, enabledProviders: string[] = ["google"]) {
  process.env = {
    ...originalEnv,
    APP_JWT_SECRET: "test-app-jwt-secret-with-sufficient-length",
    DATABASE_URL: "postgres://autoflow:test@localhost:5432/autoflow",
    ALLOWED_ORIGINS: "https://dashboard.autoflow.test",
    SOCIAL_AUTH_DASHBOARD_URL: "https://dashboard.autoflow.test",
  };

  jest.resetModules();
  jest.doMock("passport", () => {
    const mockedPassport = {
      initialize: jest.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
      authenticate: jest.fn(authenticateImpl),
    };
    return {
      __esModule: true,
      ...mockedPassport,
      default: mockedPassport,
    };
  });
  jest.doMock("./socialAuthStrategies", () => ({
    configureSocialAuthStrategies: jest.fn(),
    getSocialAuthConfigurationError: jest.fn(() => null),
    isSocialAuthProviderEnabled: (provider: string) => enabledProviders.includes(provider),
  }));
  jest.doMock("../db/postgres", () => ({
    getPostgresPool: jest.fn(),
    isPostgresConfigured: () => true,
    isPostgresPersistenceEnabled: () => true,
  }));
  jest.doMock("../engine/llmProviders", () => ({
    getProvider: jest.fn(),
  }));

  return require("../app").default as import("express").Express;
}

function loadAppWithConfigurationError(
  authenticateImpl: PassportAuthenticate,
  providerErrors: Partial<Record<string, string>> = {}
) {
  process.env = {
    ...originalEnv,
    APP_JWT_SECRET: "test-app-jwt-secret-with-sufficient-length",
    DATABASE_URL: "postgres://autoflow:test@localhost:5432/autoflow",
    ALLOWED_ORIGINS: "https://dashboard.autoflow.test",
    SOCIAL_AUTH_DASHBOARD_URL: "https://dashboard.autoflow.test",
  };

  jest.resetModules();
  jest.doMock("passport", () => {
    const mockedPassport = {
      initialize: jest.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
      authenticate: jest.fn(authenticateImpl),
    };
    return {
      __esModule: true,
      ...mockedPassport,
      default: mockedPassport,
    };
  });
  jest.doMock("./socialAuthStrategies", () => ({
    configureSocialAuthStrategies: jest.fn(),
    getSocialAuthConfigurationError: (provider: string) => providerErrors[provider] ?? null,
    isSocialAuthProviderEnabled: () => true,
  }));
  jest.doMock("../db/postgres", () => ({
    getPostgresPool: jest.fn(),
    isPostgresConfigured: () => true,
    isPostgresPersistenceEnabled: () => true,
  }));
  jest.doMock("../engine/llmProviders", () => ({
    getProvider: jest.fn(),
  }));

  return require("../app").default as import("express").Express;
}

function loadAppWithoutDefaultDashboardRedirect(
  authenticateImpl: PassportAuthenticate,
  enabledProviders: string[] = ["google"]
) {
  delete process.env.SOCIAL_AUTH_DASHBOARD_URL;
  const app = loadApp(authenticateImpl, enabledProviders);
  delete process.env.SOCIAL_AUTH_DASHBOARD_URL;
  return app;
}

describe("social auth routes", () => {
  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it("starts the Google auth flow with signed state and email scope", async () => {
    const authenticate = jest.fn<ReturnType<PassportAuthenticate>, Parameters<PassportAuthenticate>>(
      (_strategy, _options) => (_req, res) => {
        res.status(204).end();
      }
    );
    const app = loadAppWithoutDefaultDashboardRedirect(authenticate);

    const response = await request(app)
      .get("/api/auth/social/google")
      .query({ redirect_uri: "https://dashboard.autoflow.test/auth/callback" });

    expect(response.status).toBe(204);
    expect(authenticate).toHaveBeenCalledWith(
      "google",
      expect.objectContaining({
        scope: ["profile", "email"],
        session: false,
        state: expect.any(String),
      })
    );
    expect(response.headers["set-cookie"]).toEqual(
      expect.arrayContaining([expect.stringMatching(new RegExp(`^${SOCIAL_AUTH_NONCE_COOKIE_NAME}=`))])
    );
    expect(response.headers["set-cookie"]).toEqual(
      expect.arrayContaining([expect.stringMatching(/HttpOnly/i), expect.stringMatching(/SameSite=Lax/i)])
    );
  });

  it("returns an app-issued token and user payload after a successful callback", async () => {
    const authenticate = jest.fn<ReturnType<PassportAuthenticate>, Parameters<PassportAuthenticate>>(
      (_strategy, _options, callback) => (_req, _res, next) => {
        callback?.(null, {
          id: "local-user-123",
          email: "local@example.com",
          displayName: "Local User",
          provider: "google",
        });
        void next;
      }
    );
    const app = loadAppWithoutDefaultDashboardRedirect(authenticate);

    const nonce = createSocialAuthNonce();
    const state = createSocialAuthState({ nonce });
    const response = await request(app)
      .get("/api/auth/social/google/callback")
      .query({ state, code: "test-code" })
      .set("Cookie", `${SOCIAL_AUTH_NONCE_COOKIE_NAME}=${encodeURIComponent(nonce)}`);

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({
      id: "local-user-123",
      email: "local@example.com",
      name: "Local User",
      provider: "google",
    });
    expect(typeof response.body.token).toBe("string");
    expect(response.headers["set-cookie"]).toEqual(
      expect.arrayContaining([expect.stringMatching(new RegExp(`^${SOCIAL_AUTH_NONCE_COOKIE_NAME}=;`))])
    );
  });

  it("redirects to the approved frontend target with the token in the fragment", async () => {
    const authenticate = jest.fn<ReturnType<PassportAuthenticate>, Parameters<PassportAuthenticate>>(
      (_strategy, _options, callback) => (_req, _res, next) => {
        callback?.(null, {
          id: "local-user-abc",
          email: "local@example.com",
          displayName: "Local User",
          provider: "google",
        });
        void next;
      }
    );
    process.env = {
      ...originalEnv,
      APP_JWT_SECRET: "test-app-jwt-secret-with-sufficient-length",
      ALLOWED_ORIGINS: "https://dashboard.autoflow.test",
    };
    const nonce = createSocialAuthNonce();
    const state = createSocialAuthState({
      nonce,
      redirectUri: "https://dashboard.autoflow.test/auth/callback",
    });
    const app = loadApp(authenticate);

    const response = await request(app)
      .get("/api/auth/social/google/callback")
      .query({ state, code: "provider-code" })
      .set("Cookie", `${SOCIAL_AUTH_NONCE_COOKIE_NAME}=${encodeURIComponent(nonce)}`);

    expect(response.status).toBe(302);
    expect(response.headers.location).toMatch(
      /^https:\/\/dashboard\.autoflow\.test\/auth\/callback#token=.+&provider=google$/
    );
  });

  it("redirects to the default dashboard callback when no redirect_uri is supplied", async () => {
    const authenticate = jest.fn<ReturnType<PassportAuthenticate>, Parameters<PassportAuthenticate>>(
      (_strategy, _options, callback) => (_req, _res, next) => {
        callback?.(null, {
          id: "local-user-xyz",
          email: "local@example.com",
          displayName: "Local User",
          provider: "google",
        });
        void next;
      }
    );
    const app = loadApp(authenticate);
    const nonce = createSocialAuthNonce();
    const state = createSocialAuthState({ nonce });

    const response = await request(app)
      .get("/api/auth/social/google/callback")
      .query({ state, code: "test-code" })
      .set("Cookie", `${SOCIAL_AUTH_NONCE_COOKIE_NAME}=${encodeURIComponent(nonce)}`);

    expect(response.status).toBe(302);
    expect(response.headers.location).toMatch(
      /^https:\/\/dashboard\.autoflow\.test\/auth\/social-callback#token=.+&provider=google$/
    );
  });

  it("rejects callbacks when the session-binding nonce does not match", async () => {
    const authenticate = jest.fn<ReturnType<PassportAuthenticate>, Parameters<PassportAuthenticate>>(
      (_strategy, _options, callback) => (_req, _res, next) => {
        callback?.(null, {
          id: "local-user-mismatch",
          email: "local@example.com",
          displayName: "Local User",
          provider: "google",
        });
        void next;
      }
    );
    const app = loadApp(authenticate);
    const state = createSocialAuthState({
      nonce: createSocialAuthNonce(),
      redirectUri: "https://dashboard.autoflow.test/auth/callback",
    });

    const response = await request(app)
      .get("/api/auth/social/google/callback")
      .query({ state, code: "provider-code" })
      .set("Cookie", `${SOCIAL_AUTH_NONCE_COOKIE_NAME}=different-nonce`);

    expect(response.status).toBe(302);
    expect(response.headers.location).toMatch(
      /#error=social_auth_failed&error_description=Authentication\+state\+is\+invalid\+or\+expired\./
    );
  });

  it("returns 404 when a provider is not enabled for the current release", async () => {
    const authenticate = jest.fn<ReturnType<PassportAuthenticate>, Parameters<PassportAuthenticate>>(
      () => (_req, res) => {
        res.status(204).end();
      }
    );
    const app = loadApp(authenticate, ["google"]);

    const response = await request(app).get("/api/auth/social/facebook");

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/provider is not enabled/i);
  });

  it("returns 503 JSON when a provider fails during strategy configuration", async () => {
    const authenticate = jest.fn<ReturnType<PassportAuthenticate>, Parameters<PassportAuthenticate>>(
      () => (_req, res) => {
        res.status(204).end();
      }
    );
    const app = loadAppWithConfigurationError(authenticate, {
      google: "Cannot find module 'passport-google-oauth20'",
    });

    const response = await request(app).get("/api/auth/social/google");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: "Social auth provider is unavailable: google",
      details: "Cannot find module 'passport-google-oauth20'",
    });
  });

  it("returns 404 when the provider is unsupported", async () => {
    const authenticate = jest.fn<ReturnType<PassportAuthenticate>, Parameters<PassportAuthenticate>>(
      () => (_req, res) => {
        res.status(204).end();
      }
    );
    const app = loadApp(authenticate);

    const response = await request(app).get("/api/auth/social/linkedin");

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/Unsupported social auth provider/i);
  });
});
