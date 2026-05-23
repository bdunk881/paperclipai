import request from "supertest";

const originalEnv = process.env;

type SignUpFn = jest.Mock;
type SignInFn = jest.Mock;
type SignOutFn = jest.Mock;
type ResetFn = jest.Mock;

interface MockAuthClient {
  auth: {
    signUp: SignUpFn;
    signInWithPassword: SignInFn;
    signOut: SignOutFn;
    resetPasswordForEmail: ResetFn;
  };
}

interface CreateServerClientCall {
  url: string;
  key: string;
  // The @supabase/ssr cookie methods bound to (req, res).
  cookies: {
    getAll: () => Array<{ name: string; value: string }>;
    setAll: (
      cookiesToSet: Array<{
        name: string;
        value: string;
        options?: Record<string, unknown>;
      }>
    ) => void;
  };
}

function makeMockAuthClient(overrides: Partial<MockAuthClient["auth"]> = {}): MockAuthClient {
  return {
    auth: {
      signUp: jest.fn(),
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      resetPasswordForEmail: jest.fn(),
      ...overrides,
    },
  };
}

function loadApp(opts: {
  withSupabaseEnv: boolean;
  mockClient?: MockAuthClient;
  onCreateServerClient?: (call: CreateServerClientCall) => void;
  extraEnv?: Record<string, string>;
}): { app: import("express").Express; client: MockAuthClient | null } {
  const env: NodeJS.ProcessEnv = {
    ...originalEnv,
    ALLOWED_ORIGINS: "https://dashboard.autoflow.test",
    APP_JWT_SECRET: "test-app-jwt-secret-with-sufficient-length",
    DATABASE_URL: "postgres://autoflow:test@localhost:5432/autoflow",
    ...(opts.extraEnv ?? {}),
  };
  if (opts.withSupabaseEnv) {
    env.SUPABASE_URL = "https://test.supabase.co";
    env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key";
  } else {
    delete env.SUPABASE_URL;
    delete env.SUPABASE_PUBLISHABLE_KEY;
  }
  process.env = env;

  jest.resetModules();

  const client = opts.mockClient ?? makeMockAuthClient();
  jest.doMock("@supabase/ssr", () => ({
    __esModule: true,
    createServerClient: jest.fn((url: string, key: string, options: { cookies: CreateServerClientCall["cookies"] }) => {
      opts.onCreateServerClient?.({ url, key, cookies: options.cookies });
      return client;
    }),
  }));

  // Stub passport to a no-op so social-auth route imports don't blow up.
  jest.doMock("passport", () => {
    const mockedPassport = {
      initialize: jest.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
      authenticate: jest.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
    };
    return { __esModule: true, ...mockedPassport, default: mockedPassport };
  });
  jest.doMock("./socialAuthStrategies", () => ({
    configureSocialAuthStrategies: jest.fn(),
    getSocialAuthConfigurationError: () => null,
    isSocialAuthProviderEnabled: () => true,
  }));
  jest.doMock("../db/postgres", () => ({
    getPostgresPool: jest.fn(),
    inMemoryAllowed: () => true,
    isPostgresConfigured: () => false,
    isPostgresPersistenceEnabled: () => false,
  }));
  jest.doMock("../engine/llmProviders", () => ({ getProvider: jest.fn() }));

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const app = require("../app").default as import("express").Express;
  return { app, client: opts.withSupabaseEnv ? client : null };
}

jest.setTimeout(30_000);

describe("password auth routes", () => {
  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
    jest.restoreAllMocks();
  });

  describe("when Supabase env is missing", () => {
    it("returns 503 for every route and never instantiates a client", async () => {
      const onCreate = jest.fn();
      const { app } = loadApp({ withSupabaseEnv: false, onCreateServerClient: onCreate });

      for (const path of ["/sign-up", "/sign-in", "/sign-out", "/forgot-password"]) {
        const res = await request(app)
          .post(`/api/auth${path}`)
          .send({ email: "user@example.com", password: "password1234" });
        expect(res.status).toBe(503);
        expect(res.body).toEqual({ error: "Auth service not configured." });
      }

      expect(onCreate).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/auth/sign-up", () => {
    it("returns pendingConfirmation when no session is issued", async () => {
      const mockClient = makeMockAuthClient({
        signUp: jest.fn().mockResolvedValue({
          data: { session: null, user: { id: "u-1", email: "user@example.com" } },
          error: null,
        }),
      });
      const { app } = loadApp({ withSupabaseEnv: true, mockClient });

      const res = await request(app)
        .post("/api/auth/sign-up")
        .send({ email: "user@example.com", password: "password1234", name: "Avery" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        pendingConfirmation: true,
        user: { id: "u-1", email: "user@example.com" },
      });
      expect(mockClient.auth.signUp).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "user@example.com",
          password: "password1234",
          options: expect.objectContaining({
            emailRedirectTo: expect.stringContaining("/auth/confirm?next=/"),
            data: { full_name: "Avery" },
          }),
        })
      );
    });

    it("returns 400 with the Supabase error message on failure", async () => {
      const mockClient = makeMockAuthClient({
        signUp: jest.fn().mockResolvedValue({
          data: { session: null, user: null },
          error: { message: "User already registered" },
        }),
      });
      const { app } = loadApp({ withSupabaseEnv: true, mockClient });

      const res = await request(app)
        .post("/api/auth/sign-up")
        .send({ email: "user@example.com", password: "password1234" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "User already registered" });
    });

    it("returns 400 when email or password is missing", async () => {
      const { app } = loadApp({ withSupabaseEnv: true });
      const res = await request(app).post("/api/auth/sign-up").send({ email: "x@y.com" });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "email and password are required." });
    });
  });

  describe("POST /api/auth/sign-in", () => {
    it("returns the user on success and persists cookies via the SSR adapter", async () => {
      const capturedCookies: Array<{ name: string; value: string; options?: Record<string, unknown> }> = [];
      let cookieAdapter: CreateServerClientCall["cookies"] | null = null;
      const signInWithPassword = jest.fn().mockImplementation(async () => {
        cookieAdapter?.setAll([
          {
            name: "sb-access-token",
            value: "access-token-abc",
            options: { maxAge: 3600 },
          },
        ]);
        return {
          data: { user: { id: "u-1", email: "user@example.com" }, session: { access_token: "access-token-abc" } },
          error: null,
        };
      });
      const mockClient = makeMockAuthClient({ signInWithPassword });

      const { app } = loadApp({
        withSupabaseEnv: true,
        mockClient,
        onCreateServerClient: (call) => {
          cookieAdapter = call.cookies;
          const originalSetAll = call.cookies.setAll;
          call.cookies.setAll = (cookies) => {
            cookies.forEach((c) => capturedCookies.push(c));
            originalSetAll(cookies);
          };
        },
      });

      const res = await request(app)
        .post("/api/auth/sign-in")
        .send({ email: "user@example.com", password: "password1234" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ user: { id: "u-1", email: "user@example.com" } });
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "password1234",
      });

      expect(capturedCookies).toHaveLength(1);
      const setCookie = res.headers["set-cookie"];
      const setCookieList: string[] = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
      const accessCookie = setCookieList.find((entry: string) => entry.startsWith("sb-access-token="));
      expect(accessCookie).toBeDefined();
      expect(accessCookie).toMatch(/HttpOnly/i);
      expect(accessCookie).toMatch(/SameSite=Lax/i);
      // NODE_ENV is "test" in jest, so Secure must NOT be set.
      expect(accessCookie).not.toMatch(/Secure/i);
    });

    it("returns 400 on a Supabase sign-in error", async () => {
      const mockClient = makeMockAuthClient({
        signInWithPassword: jest.fn().mockResolvedValue({
          data: { user: null, session: null },
          error: { message: "Invalid login credentials" },
        }),
      });
      const { app } = loadApp({ withSupabaseEnv: true, mockClient });

      const res = await request(app)
        .post("/api/auth/sign-in")
        .send({ email: "user@example.com", password: "wrong" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Invalid login credentials" });
    });
  });

  describe("POST /api/auth/sign-out", () => {
    it("calls signOut and returns 204", async () => {
      const signOut = jest.fn().mockResolvedValue({ error: null });
      const mockClient = makeMockAuthClient({ signOut });
      const { app } = loadApp({ withSupabaseEnv: true, mockClient });

      const res = await request(app).post("/api/auth/sign-out");

      expect(res.status).toBe(204);
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    });
  });

  describe("POST /api/auth/forgot-password", () => {
    it("invokes resetPasswordForEmail with a dashboard-bound redirect", async () => {
      const resetPasswordForEmail = jest.fn().mockResolvedValue({ error: null });
      const mockClient = makeMockAuthClient({ resetPasswordForEmail });
      const { app } = loadApp({
        withSupabaseEnv: true,
        mockClient,
        extraEnv: { DASHBOARD_ORIGIN: "https://app.example.test" },
      });

      const res = await request(app)
        .post("/api/auth/forgot-password")
        .send({ email: "user@example.com" });

      expect(res.status).toBe(202);
      expect(resetPasswordForEmail).toHaveBeenCalledWith("user@example.com", {
        redirectTo: "https://app.example.test/reset-password",
      });
    });

    it("returns 400 when email is missing", async () => {
      const { app } = loadApp({ withSupabaseEnv: true });
      const res = await request(app).post("/api/auth/forgot-password").send({});
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "email is required." });
    });
  });
});
