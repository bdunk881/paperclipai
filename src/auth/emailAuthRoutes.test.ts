import express from "express";
import request from "supertest";

const originalEnv = process.env;

const mockVerifyOtp = jest.fn();

jest.mock("../queue/redisClient", () => ({
  getRedisClient: jest.fn(() => null),
}));

jest.mock("./supabaseServiceClient", () => ({
  getSupabaseServiceClient: jest.fn(() => ({
    auth: {
      verifyOtp: mockVerifyOtp,
      refreshSession: jest.fn(),
    },
  })),
  sessionRecordFromSupabaseSession: jest.fn((session: {
    access_token: string;
    refresh_token: string;
    expires_at?: number;
    user: { id: string; email: string; user_metadata?: Record<string, unknown> };
  }) => ({
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.email,
    },
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: (session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000,
  })),
  resetSupabaseServiceClientForTests: jest.fn(),
}));

function loadRouterApp() {
  process.env = {
    ...originalEnv,
    NODE_ENV: "test",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    DASHBOARD_PUBLIC_URL: "https://dashboard.autoflow.test",
    API_PUBLIC_URL: "https://api.autoflow.test",
    AUTH_RETURN_TOKENS_IN_BODY: "true",
  };

  jest.resetModules();

  const { resetEmailAuthSessionStoreForTests } = require("./emailAuthSessionStore");
  resetEmailAuthSessionStoreForTests();

  const emailAuthRoutes = require("./emailAuthRoutes").default;
  const app = express();
  app.use(express.json());
  app.use("/api/auth", emailAuthRoutes);
  return app;
}

describe("emailAuthRoutes", () => {
  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
    mockVerifyOtp.mockReset();
  });

  it("redirects to login when token_hash is missing", async () => {
    const app = loadRouterApp();
    const response = await request(app).get("/api/auth/email/callback");

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("https://dashboard.autoflow.test/login");
    expect(response.headers.location).toContain("authError=");
  });

  it("exchanges token_hash and sets session cookie", async () => {
    mockVerifyOtp.mockResolvedValue({
      data: {
        session: {
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: "user-1", email: "user@example.com", user_metadata: {} },
        },
      },
      error: null,
    });

    const app = loadRouterApp();
    const response = await request(app).get(
      "/api/auth/email/callback?token_hash=hash-abc&type=email",
    );

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      token_hash: "hash-abc",
      type: "email",
    });
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("https://dashboard.autoflow.test/");
    const setCookie = response.headers["set-cookie"];
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join(";") : String(setCookie ?? "");
    expect(cookieHeader).toContain("autoflow_session=");
  });

  it("verifies email OTP and returns session JSON", async () => {
    mockVerifyOtp.mockResolvedValue({
      data: {
        session: {
          access_token: "access-2",
          refresh_token: "refresh-2",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: "user-2", email: "otp@example.com", user_metadata: {} },
        },
      },
      error: null,
    });

    const app = loadRouterApp();
    const response = await request(app)
      .post("/api/auth/verify-otp")
      .send({ email: "otp@example.com", token: "123456" });

    expect(response.status).toBe(200);
    expect(response.body.session.accessToken).toBe("access-2");
    expect(response.body.session.user.email).toBe("otp@example.com");
  });

  it("returns session for cookie-authenticated callers", async () => {
    mockVerifyOtp.mockResolvedValue({
      data: {
        session: {
          access_token: "access-3",
          refresh_token: "refresh-3",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: "user-3", email: "cookie@example.com", user_metadata: {} },
        },
      },
      error: null,
    });

    const app = loadRouterApp();
    const signIn = await request(app)
      .post("/api/auth/verify-otp")
      .send({ email: "cookie@example.com", token: "654321" });

    const cookie = signIn.headers["set-cookie"];
    const sessionResponse = await request(app).get("/api/auth/session").set("Cookie", cookie);

    expect(sessionResponse.status).toBe(200);
    expect(sessionResponse.body.session.user.id).toBe("user-3");
  });
});
