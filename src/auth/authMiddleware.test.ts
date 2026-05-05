import type { AuthenticatedRequest } from "./authMiddleware";

function createResponse() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { status, json };
}

function loadRequireAuth() {
  let requireAuth: typeof import("./authMiddleware").requireAuth;

  jest.isolateModules(() => {
    ({ requireAuth } = require("./authMiddleware") as typeof import("./authMiddleware"));
  });

  return requireAuth!;
}

function loadRequireAuthOrQaBypass() {
  let requireAuthOrQaBypass: typeof import("./authMiddleware").requireAuthOrQaBypass;

  jest.isolateModules(() => {
    ({ requireAuthOrQaBypass } = require("./authMiddleware") as typeof import("./authMiddleware"));
  });

  return requireAuthOrQaBypass!;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

describe("requireAuth", () => {
  const originalEnv = process.env;
  const verifyMock = jest.fn();
  const jwtVerifyMock = jest.fn();
  const recordControlPlaneAuditMock = jest.fn().mockResolvedValue(undefined);
  const resolveAuditWorkspaceIdForUserMock = jest.fn().mockResolvedValue("workspace-123");
  const warnMock = jest.spyOn(console, "warn").mockImplementation(() => undefined);

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    verifyMock.mockReset();
    jwtVerifyMock.mockReset();
    process.env = { ...originalEnv };

    jest.doMock("jsonwebtoken", () => ({
      __esModule: true,
      default: {
        verify: verifyMock,
      },
    }));

    jest.doMock("jose", () => ({
      __esModule: true,
      createRemoteJWKSet: jest.fn(() => "remote-jwks"),
      jwtVerify: jwtVerifyMock,
    }));

    jest.doMock("../auditing/controlPlaneAudit", () => ({
      __esModule: true,
      recordControlPlaneAudit: recordControlPlaneAuditMock,
      recordControlPlaneAuditBatch: jest.fn().mockResolvedValue(undefined),
      resolveAuditWorkspaceIdForUser: resolveAuditWorkspaceIdForUserMock,
    }));
  });

  afterAll(() => {
    warnMock.mockRestore();
    process.env = originalEnv;
  });

  it("accepts X-User-Id for /api/memory when Authorization is missing", () => {
    const requireAuth = loadRequireAuth();
    const req = {
      headers: { "x-user-id": "demo-user" },
      originalUrl: "/api/memory",
      path: "/api/memory",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();
    const next = jest.fn();

    requireAuth(req, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth?.sub).toBe("demo-user");
    expect(res.status).not.toHaveBeenCalled();
  });

  it("accepts X-User-Id for /api/knowledge routes when Authorization is missing", () => {
    const requireAuth = loadRequireAuth();
    const req = {
      headers: { "x-user-id": "qa-test-user" },
      originalUrl: "/api/knowledge/bases",
      path: "/api/knowledge/bases",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();
    const next = jest.fn();

    requireAuth(req, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth?.sub).toBe("qa-test-user");
    expect(res.status).not.toHaveBeenCalled();
  });

  it("accepts X-User-Id for GET /api/runs when Authorization is missing", () => {
    const requireAuth = loadRequireAuth();
    const req = {
      method: "GET",
      headers: { "x-user-id": "preview-user" },
      originalUrl: "/api/runs",
      path: "/api/runs",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();
    const next = jest.fn();

    requireAuth(req, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth?.sub).toBe("preview-user");
    expect(res.status).not.toHaveBeenCalled();
  });

  it("accepts X-User-Id for GET /api/llm-configs when Authorization is missing", () => {
    const requireAuth = loadRequireAuth();
    const req = {
      method: "GET",
      headers: { "x-user-id": "preview-user" },
      originalUrl: "/api/llm-configs",
      path: "/api/llm-configs",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();
    const next = jest.fn();

    requireAuth(req, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth?.sub).toBe("preview-user");
    expect(res.status).not.toHaveBeenCalled();
  });

  it("does not allow QA bypass on protected routes through requireAuth", () => {
    process.env.NODE_ENV = "test";
    process.env.QA_AUTH_BYPASS_ENABLED = "true";
    process.env.QA_AUTH_BYPASS_USER_IDS = "qa-smoke-user";

    const requireAuth = loadRequireAuth();
    const req = {
      method: "GET",
      headers: { "x-user-id": "qa-smoke-user" },
      originalUrl: "/api/control-plane/teams",
      path: "/api/control-plane/teams",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();
    const next = jest.fn();

    requireAuth(req, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(req.auth).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("allows QA bypass on integrations routes through requireAuth", async () => {
    process.env.NODE_ENV = "test";
    process.env.QA_AUTH_BYPASS_ENABLED = "true";
    process.env.QA_AUTH_BYPASS_USER_IDS = "qa-smoke-user";

    const requireAuth = loadRequireAuth();
    const req = {
      method: "POST",
      headers: { "x-user-id": "qa-smoke-user", "x-workspace-id": "workspace-123" },
      originalUrl: "/api/integrations/apollo/oauth/start",
      path: "/api/integrations/apollo/oauth/start",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();
    const next = jest.fn();

    requireAuth(req, res as never, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth?.sub).toBe("qa-smoke-user");
    expect(recordControlPlaneAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-123",
        userId: "qa-smoke-user",
        category: "bypass_attempt",
        action: "qa_auth_bypass_attempt",
      })
    );
    expect(recordControlPlaneAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-123",
        userId: "qa-smoke-user",
        category: "auth",
        action: "qa_auth_bypass_authenticated",
      })
    );
  });

  it("rejects non-allowlisted QA bypass users on protected routes", () => {
    process.env.NODE_ENV = "test";
    process.env.QA_AUTH_BYPASS_ENABLED = "true";
    process.env.QA_AUTH_BYPASS_USER_IDS = "qa-smoke-user";

    const requireAuth = loadRequireAuth();
    const req = {
      method: "GET",
      headers: { "x-user-id": "not-allowed" },
      originalUrl: "/api/control-plane/teams",
      path: "/api/control-plane/teams",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();
    const next = jest.fn();

    requireAuth(req, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("still rejects non-allowlisted routes without Authorization", () => {
    const requireAuth = loadRequireAuth();
    const req = {
      method: "POST",
      headers: { "x-user-id": "demo-user" },
      originalUrl: "/api/runs",
      path: "/api/runs",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();
    const next = jest.fn();

    requireAuth(req, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("accepts app-issued JWTs when the issuer matches the local app auth config", () => {
    process.env.APP_JWT_SECRET = "test-app-jwt-secret-with-sufficient-length";

    verifyMock.mockReturnValue({
      sub: "local-user-123",
      email: "local@example.com",
      name: "Local User",
      provider: "google",
      iss: "autoflow-app",
    });

    const payload = Buffer.from(JSON.stringify({ iss: "autoflow-app" })).toString("base64url");
    const requireAuth = loadRequireAuth();
    const req = {
      headers: { authorization: `Bearer header.${payload}.signature` },
      originalUrl: "/api/me",
      path: "/api/me",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();
    const next = jest.fn();

    requireAuth(req, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth).toMatchObject({
      sub: "local-user-123",
      email: "local@example.com",
      name: "Local User",
      provider: "google",
      issuer: "autoflow-app",
    });
    expect(verifyMock).toHaveBeenCalledWith(
      expect.any(String),
      "test-app-jwt-secret-with-sufficient-length",
      expect.objectContaining({
        algorithms: ["HS256"],
        audience: "autoflow-api",
        issuer: "autoflow-app",
      })
    );
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it("logs and rejects app-token-like JWTs when local app verification fails", () => {
    process.env.APP_JWT_SECRET = "test-app-jwt-secret-with-sufficient-length";

    verifyMock.mockImplementation(() => {
      throw new Error("jwt audience invalid. expected: autoflow-api");
    });

    const payload = Buffer.from(
      JSON.stringify({ iss: "autoflow-app", aud: "autoflow-api", exp: 1_900_000_000 })
    ).toString("base64url");
    const requireAuth = loadRequireAuth();
    const req = {
      headers: { authorization: `Bearer header.${payload}.signature` },
      originalUrl: "/api/agents",
      path: "/api/agents",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    requireAuth(req, res as never, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(warnMock).toHaveBeenCalledWith(
      "[auth] App JWT verification failed",
      expect.objectContaining({
        errMessage: "jwt audience invalid. expected: autoflow-api",
        tokenAud: "autoflow-api",
        tokenIss: "autoflow-app",
        expectedAudience: "autoflow-api",
        expectedIssuer: "autoflow-app",
      })
    );
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it("accepts Supabase JWTs using SUPABASE_URL and default authenticated audience", async () => {
    process.env.SUPABASE_URL = "https://autoflow.supabase.co";

    jwtVerifyMock.mockResolvedValue({
      payload: {
        sub: "user-123",
        email: "user@example.com",
        iss: "https://autoflow.supabase.co/auth/v1",
        app_metadata: { provider: "google" },
        user_metadata: { full_name: "Supabase User" },
      },
    });

    const payload = Buffer.from(
      JSON.stringify({
        iss: "https://autoflow.supabase.co/auth/v1",
        aud: "authenticated",
      })
    ).toString("base64url");
    const requireAuth = loadRequireAuth();
    const req = {
      headers: { authorization: `Bearer header.${payload}.signature` },
      originalUrl: "/api/me",
      path: "/api/me",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();
    const next = jest.fn();

    requireAuth(req, res as never, next);
    await flushMicrotasks();

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth).toMatchObject({
      sub: "user-123",
      email: "user@example.com",
      name: "Supabase User",
      provider: "google",
      issuer: "https://autoflow.supabase.co/auth/v1",
    });
    expect(jwtVerifyMock).toHaveBeenCalledWith(
      expect.any(String),
      "remote-jwks",
      expect.objectContaining({
        issuer: "https://autoflow.supabase.co/auth/v1",
        audience: ["authenticated"],
      })
    );
  });

  it("accepts explicit Supabase audience allowlists", async () => {
    process.env.SUPABASE_URL = "https://autoflow.supabase.co";
    process.env.SUPABASE_JWT_AUDIENCES = "authenticated,custom-audience";

    jwtVerifyMock.mockResolvedValue({
      payload: {
        sub: "user-456",
        email: "oauth@example.com",
        iss: "https://autoflow.supabase.co/auth/v1",
      },
    });

    const requireAuth = loadRequireAuth();
    const req = {
      headers: { authorization: "Bearer supabase-token" },
      originalUrl: "/api/agents",
      path: "/api/agents",
    } as unknown as AuthenticatedRequest;

    requireAuth(req, createResponse() as never, jest.fn());
    await flushMicrotasks();

    expect(jwtVerifyMock).toHaveBeenCalledWith(
      expect.any(String),
      "remote-jwks",
      expect.objectContaining({
        audience: ["authenticated", "custom-audience"],
      })
    );
  });

  it("returns 503 when neither app JWT nor Supabase auth is configured", () => {
    delete process.env.APP_JWT_SECRET;
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const requireAuth = loadRequireAuth();
    const req = {
      headers: { authorization: "Bearer unconfigured-token" },
      originalUrl: "/api/me",
      path: "/api/me",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    requireAuth(req, res as never, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it("logs Supabase JWT verification diagnostics without logging the raw token", async () => {
    process.env.SUPABASE_URL = "https://autoflow.supabase.co";

    jwtVerifyMock.mockRejectedValue(new Error("unexpected \"aud\" claim value"));

    const payload = Buffer.from(
      JSON.stringify({
        aud: "anon",
        iss: "https://autoflow.supabase.co/auth/v1",
        exp: 1234567890,
        nbf: 1234567000,
      })
    ).toString("base64url");
    const token = `header.${payload}.signature`;
    const requireAuth = loadRequireAuth();
    const req = {
      headers: { authorization: `Bearer ${token}` },
      originalUrl: "/api/me",
      path: "/api/me",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    requireAuth(req, res as never, jest.fn());
    await flushMicrotasks();

    expect(warnMock).toHaveBeenCalledWith("[auth] Supabase JWT verification failed", {
      errName: "Error",
      errMessage: "unexpected \"aud\" claim value",
      tokenAud: "anon",
      tokenIss: "https://autoflow.supabase.co/auth/v1",
      tokenExp: 1234567890,
      tokenNbf: 1234567000,
      expectedAudiences: ["authenticated"],
      expectedIssuer: "https://autoflow.supabase.co/auth/v1",
      jwksUri: "https://autoflow.supabase.co/auth/v1/.well-known/jwks.json",
    });
    expect(JSON.stringify(warnMock.mock.calls)).not.toContain(token);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("allows QA bypass for allowlisted users and records both bypass and auth audit events", async () => {
    process.env.NODE_ENV = "test";
    process.env.QA_AUTH_BYPASS_ENABLED = "true";
    process.env.QA_AUTH_BYPASS_USER_IDS = "qa-user";

    const requireAuthOrQaBypass = loadRequireAuthOrQaBypass();
    const req = {
      method: "POST",
      headers: { "x-user-id": "qa-user", "x-workspace-id": "workspace-123" },
      originalUrl: "/api/control-plane/teams",
      path: "/api/control-plane/teams",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();
    const next = jest.fn();

    requireAuthOrQaBypass(req, res as never, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth?.sub).toBe("qa-user");
    expect(recordControlPlaneAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-123",
        userId: "qa-user",
        category: "bypass_attempt",
        action: "qa_auth_bypass_attempt",
      })
    );
    expect(recordControlPlaneAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-123",
        userId: "qa-user",
        category: "auth",
        action: "qa_auth_bypass_authenticated",
      })
    );
  });

  it("records denied QA bypass attempts for non-allowlisted users", async () => {
    process.env.NODE_ENV = "test";
    process.env.QA_AUTH_BYPASS_ENABLED = "true";
    process.env.QA_AUTH_BYPASS_USER_IDS = "qa-user";

    const requireAuthOrQaBypass = loadRequireAuthOrQaBypass();
    const req = {
      method: "POST",
      headers: { "x-user-id": "not-allowed", "x-workspace-id": "workspace-123" },
      originalUrl: "/api/control-plane/teams",
      path: "/api/control-plane/teams",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    requireAuthOrQaBypass(req, res as never, jest.fn());
    await new Promise((resolve) => setImmediate(resolve));

    expect(recordControlPlaneAuditMock).toHaveBeenCalledTimes(1);
    expect(recordControlPlaneAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-123",
        userId: "not-allowed",
        category: "bypass_attempt",
        action: "qa_auth_bypass_attempt",
        metadata: expect.objectContaining({
          outcome: "denied",
          reason: "not_allowlisted",
        }),
      })
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
