import type { JwtPayload } from "jsonwebtoken";
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

describe("requireAuth", () => {
  const originalEnv = process.env;
  const verifyMock = jest.fn();
  const getSigningKeyMock = jest.fn();
  const jwksClientMock = jest.fn(() => ({ getSigningKey: getSigningKeyMock }));
  const warnMock = jest.spyOn(console, "warn").mockImplementation(() => undefined);

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    verifyMock.mockReset();
    getSigningKeyMock.mockReset();
    jwksClientMock.mockClear();
    process.env = { ...originalEnv };

    jest.doMock("jsonwebtoken", () => ({
      __esModule: true,
      default: {
        verify: verifyMock,
      },
    }));

    jest.doMock("jwks-rsa", () => ({
      __esModule: true,
      default: jwksClientMock,
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

  it("accepts X-User-Id for /api/knowledge/search when Authorization is missing", () => {
    const requireAuth = loadRequireAuth();
    const req = {
      headers: { "x-user-id": "qa-test-user" },
      originalUrl: "/api/knowledge/search",
      path: "/api/knowledge/search",
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

    const payload = Buffer.from(
      JSON.stringify({ iss: "autoflow-app", exp: 1_900_000_000 })
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
  });

  it("accepts app-issued JWTs even when decoded issuer metadata does not match the current env", () => {
    process.env.APP_JWT_SECRET = "test-app-jwt-secret-with-sufficient-length";
    process.env.APP_JWT_ISSUER = "autoflow-app-current";

    verifyMock.mockReturnValue({
      sub: "local-user-456",
      email: "oauth@example.com",
      name: "OAuth User",
      provider: "google",
      iss: "autoflow-app-current",
    });

    const payload = Buffer.from(
      JSON.stringify({ iss: "autoflow-app-previous", exp: 1_900_000_000 })
    ).toString("base64url");
    const requireAuth = loadRequireAuth();
    const req = {
      headers: { authorization: `Bearer header.${payload}.signature` },
      originalUrl: "/api/agents",
      path: "/api/agents",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();
    const next = jest.fn();

    requireAuth(req, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth).toMatchObject({
      sub: "local-user-456",
      email: "oauth@example.com",
      name: "OAuth User",
      provider: "google",
      issuer: "autoflow-app-current",
    });
    expect(verifyMock).toHaveBeenCalledTimes(1);
    expect(verifyMock).toHaveBeenCalledWith(
      expect.any(String),
      "test-app-jwt-secret-with-sufficient-length",
      expect.objectContaining({
        algorithms: ["HS256"],
        audience: "autoflow-api",
        issuer: "autoflow-app-current",
      })
    );
    expect(jwksClientMock).not.toHaveBeenCalled();
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
      "jwt audience invalid. expected: autoflow-api",
      expect.objectContaining({
        tokenAud: "autoflow-api",
        tokenIss: "autoflow-app",
        expectedAudience: "autoflow-api",
        expectedIssuer: "autoflow-app",
      })
    );
    expect(jwksClientMock).not.toHaveBeenCalled();
  });

  it("rejects app-token-like JWTs before verification when exp is missing or invalid", () => {
    process.env.APP_JWT_SECRET = "test-app-jwt-secret-with-sufficient-length";

    const payload = Buffer.from(
      JSON.stringify({ iss: "autoflow-app", aud: "autoflow-api", exp: null })
    ).toString("base64url");
    const requireAuth = loadRequireAuth();
    const req = {
      headers: { authorization: `Bearer header.${payload}.signature` },
      originalUrl: "/api/agents",
      path: "/api/agents",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    requireAuth(req, res as never, jest.fn());

    expect(verifyMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(warnMock).toHaveBeenCalledWith(
      "[auth] App JWT verification failed",
      "App token is missing a numeric exp claim.",
      expect.objectContaining({
        tokenAud: "autoflow-api",
        tokenIss: "autoflow-app",
        tokenExp: null,
        expectedAudience: "autoflow-api",
        expectedIssuer: "autoflow-app",
      })
    );
  });

  it("uses legacy AZURE_* auth env vars when AZURE_CIAM_* vars are absent", () => {
    process.env.AZURE_TENANT_SUBDOMAIN = "legacyciam";
    process.env.AZURE_TENANT_ID = "legacy-tenant";
    process.env.AZURE_CLIENT_ID = "legacy-client";
    delete process.env.AZURE_CIAM_TENANT_SUBDOMAIN;
    delete process.env.AZURE_CIAM_TENANT_ID;
    delete process.env.AZURE_CIAM_CLIENT_ID;

    const requireAuth = loadRequireAuth();
    const req = {
      headers: { authorization: "Bearer legacy-token" },
      originalUrl: "/api/me",
      path: "/api/me",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();
    const next = jest.fn();

    requireAuth(req, res as never, next);

    expect(res.status).not.toHaveBeenCalledWith(503);
    expect(verifyMock).toHaveBeenCalledTimes(1);
    const [, keyResolver, options] = verifyMock.mock.calls[0];
    expect(typeof keyResolver).toBe("function");
    expect(options).toMatchObject({
      audience: expect.arrayContaining([
        "legacy-client",
        "2dfd3a08-277c-4893-b07d-eca5ae322310",
        "d36ce552-1a3d-4cd3-b851-beff4e3bf440",
      ]),
      issuer: expect.arrayContaining([
        "https://legacyciam.ciamlogin.com/legacy-tenant/v2.0",
        "https://legacy-tenant.ciamlogin.com/legacy-tenant/v2.0",
      ]),
      algorithms: ["RS256"],
    });
    keyResolver({ kid: "legacy-kid" }, jest.fn());
    expect(jwksClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jwksUri: "https://legacyciam.ciamlogin.com/legacy-tenant/discovery/v2.0/keys",
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("falls back to the repo CIAM defaults when no auth env vars are configured", () => {
    delete process.env.AZURE_CIAM_AUTHORITY;
    delete process.env.AZURE_CIAM_TENANT_SUBDOMAIN;
    delete process.env.AZURE_CIAM_TENANT_ID;
    delete process.env.AZURE_CIAM_CLIENT_ID;
    delete process.env.AZURE_CIAM_ALLOWED_AUDIENCES;
    delete process.env.AZURE_TENANT_SUBDOMAIN;
    delete process.env.AZURE_TENANT_ID;
    delete process.env.AZURE_CLIENT_ID;

    const requireAuth = loadRequireAuth();
    const req = {
      headers: { authorization: "Bearer default-token" },
      originalUrl: "/api/me",
      path: "/api/me",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    requireAuth(req, res as never, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(503);
    expect(verifyMock).toHaveBeenCalledTimes(1);
    const [, keyResolver, options] = verifyMock.mock.calls[0];
    expect(options).toMatchObject({
      audience: expect.arrayContaining([
        "2dfd3a08-277c-4893-b07d-eca5ae322310",
        "d36ce552-1a3d-4cd3-b851-beff4e3bf440",
      ]),
      issuer: expect.arrayContaining([
        "https://autoflowciam.ciamlogin.com/5e4f1080-8afc-4005-b05e-32b21e69363a/v2.0",
        "https://5e4f1080-8afc-4005-b05e-32b21e69363a.ciamlogin.com/5e4f1080-8afc-4005-b05e-32b21e69363a/v2.0",
      ]),
      algorithms: ["RS256"],
    });
    keyResolver({ kid: "default-kid" }, jest.fn());
    expect(jwksClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jwksUri:
          "https://autoflowciam.ciamlogin.com/5e4f1080-8afc-4005-b05e-32b21e69363a/discovery/v2.0/keys",
      })
    );
  });

  it("prefers AZURE_CIAM_* auth env vars over legacy AZURE_* fallbacks", () => {
    process.env.AZURE_CIAM_TENANT_SUBDOMAIN = "newciam";
    process.env.AZURE_CIAM_TENANT_ID = "new-tenant";
    process.env.AZURE_CIAM_CLIENT_ID = "new-client";
    process.env.AZURE_TENANT_SUBDOMAIN = "legacyciam";
    process.env.AZURE_TENANT_ID = "legacy-tenant";
    process.env.AZURE_CLIENT_ID = "legacy-client";

    const requireAuth = loadRequireAuth();
    const req = {
      headers: { authorization: "Bearer priority-token" },
      originalUrl: "/api/me",
      path: "/api/me",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    requireAuth(req, res as never, jest.fn());

    const [, , options] = verifyMock.mock.calls[0];
    expect(options).toMatchObject({
      audience: expect.arrayContaining(["new-client"]),
      issuer: expect.arrayContaining([
        "https://newciam.ciamlogin.com/new-tenant/v2.0",
        "https://new-tenant.ciamlogin.com/new-tenant/v2.0",
      ]),
    });
    const [, keyResolver] = verifyMock.mock.calls[0];
    keyResolver({ kid: "new-kid" }, jest.fn());
    expect(jwksClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jwksUri: "https://newciam.ciamlogin.com/new-tenant/discovery/v2.0/keys",
      })
    );
  });

  it("ignores retired non-ciam authorities and keeps tenant subdomain issuer fallback", () => {
    process.env.AZURE_CIAM_AUTHORITY = "https://legacy-auth.example.com/tenant-guid";
    process.env.AZURE_CIAM_TENANT_SUBDOMAIN = "autoflowciam";
    process.env.AZURE_CIAM_TENANT_ID = "tenant-guid";
    process.env.AZURE_CIAM_CLIENT_ID = "custom-client";

    const requireAuth = loadRequireAuth();
    const req = {
      headers: { authorization: "Bearer branded-token" },
      originalUrl: "/api/me",
      path: "/api/me",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    requireAuth(req, res as never, jest.fn());

    const [, keyResolver, options] = verifyMock.mock.calls[0];
    expect(options).toMatchObject({
      audience: expect.arrayContaining(["custom-client"]),
      issuer: expect.arrayContaining([
        "https://autoflowciam.ciamlogin.com/tenant-guid/v2.0",
        "https://tenant-guid.ciamlogin.com/tenant-guid/v2.0",
      ]),
      algorithms: ["RS256"],
    });
    keyResolver({ kid: "brand-kid" }, jest.fn());
    expect(jwksClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jwksUri: "https://autoflowciam.ciamlogin.com/tenant-guid/discovery/v2.0/keys",
      })
    );
  });

  it("accepts explicit audience allowlists for rotated app registrations", () => {
    process.env.AZURE_CIAM_TENANT_SUBDOMAIN = "newciam";
    process.env.AZURE_CIAM_TENANT_ID = "tenant-guid";
    process.env.AZURE_CIAM_ALLOWED_AUDIENCES = "new-client,legacy-client";
    delete process.env.AZURE_CIAM_CLIENT_ID;
    delete process.env.AZURE_CLIENT_ID;

    const requireAuth = loadRequireAuth();
    const req = {
      headers: { authorization: "Bearer rotated-token" },
      originalUrl: "/api/me",
      path: "/api/me",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    requireAuth(req, res as never, jest.fn());

    const [, , options] = verifyMock.mock.calls[0];
    expect(options).toMatchObject({
      audience: expect.arrayContaining([
        "new-client",
        "legacy-client",
      ]),
      issuer: expect.arrayContaining([
        "https://newciam.ciamlogin.com/tenant-guid/v2.0",
        "https://tenant-guid.ciamlogin.com/tenant-guid/v2.0",
      ]),
    });
  });

  it("logs JWT verification diagnostics without logging the raw token", () => {
    process.env.AZURE_CIAM_TENANT_SUBDOMAIN = "autoflowciam";
    process.env.AZURE_CIAM_TENANT_ID = "tenant-guid";
    process.env.AZURE_CIAM_CLIENT_ID = "custom-client";

    verifyMock.mockImplementation(
      (
        _token: string,
        _resolver: unknown,
        _options: unknown,
        callback: (err: Error | null, decoded?: string | JwtPayload) => void
      ) => {
        callback(new Error("jwt audience invalid. expected: custom-client"));
      }
    );

    const requireAuth = loadRequireAuth();
    const payload = Buffer.from(
      JSON.stringify({
        aud: "00000003-0000-0000-c000-000000000000",
        iss: "https://tenant-guid.ciamlogin.com/tenant-guid/v2.0",
        exp: 1234567890,
        nbf: 1234567000,
      })
    ).toString("base64url");
    const token = `header.${payload}.signature`;
    const req = {
      headers: { authorization: `Bearer ${token}` },
      originalUrl: "/api/me",
      path: "/api/me",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    requireAuth(req, res as never, jest.fn());

    expect(warnMock).toHaveBeenCalledWith("[auth] JWT verification failed", {
      errName: "Error",
      errMessage: "jwt audience invalid. expected: custom-client",
      tokenAud: "00000003-0000-0000-c000-000000000000",
      tokenIss: "https://tenant-guid.ciamlogin.com/tenant-guid/v2.0",
      tokenExp: 1234567890,
      tokenNbf: 1234567000,
      expectedAudiences: expect.arrayContaining([
        "custom-client",
        "2dfd3a08-277c-4893-b07d-eca5ae322310",
        "d36ce552-1a3d-4cd3-b851-beff4e3bf440",
      ]),
      expectedIssuers: expect.arrayContaining([
        "https://autoflowciam.ciamlogin.com/tenant-guid/v2.0",
        "https://tenant-guid.ciamlogin.com/tenant-guid/v2.0",
      ]),
      jwksUri: "https://autoflowciam.ciamlogin.com/tenant-guid/discovery/v2.0/keys",
    });
    expect(JSON.stringify(warnMock.mock.calls)).not.toContain(token);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
