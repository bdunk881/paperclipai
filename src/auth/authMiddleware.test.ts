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

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
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

  it("still rejects non-memory routes without Authorization", () => {
    const requireAuth = loadRequireAuth();
    const req = {
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

  it("accepts the configured QA E2E bearer token for /api/me", () => {
    process.env.QA_E2E_BEARER_TOKEN = "qa-secret";
    process.env.QA_E2E_USER_ID = "usr-qa-preview";
    process.env.QA_E2E_USER_EMAIL = "qa-preview@autoflow.local";
    process.env.QA_E2E_USER_NAME = "QA Preview User";

    const requireAuth = loadRequireAuth();
    const req = {
      headers: { authorization: "Bearer qa-secret" },
      originalUrl: "/api/me",
      path: "/api/me",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();
    const next = jest.fn();

    requireAuth(req, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth).toEqual({
      sub: "usr-qa-preview",
      email: "qa-preview@autoflow.local",
      name: "QA Preview User",
    });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("rejects the QA E2E bearer token outside the allowed QA routes", () => {
    process.env.QA_E2E_BEARER_TOKEN = "qa-secret";
    delete process.env.AZURE_TENANT_SUBDOMAIN;
    delete process.env.AZURE_TENANT_ID;
    delete process.env.AZURE_CLIENT_ID;
    delete process.env.AZURE_CIAM_TENANT_SUBDOMAIN;
    delete process.env.AZURE_CIAM_TENANT_ID;
    delete process.env.AZURE_CIAM_CLIENT_ID;

    const requireAuth = loadRequireAuth();
    const req = {
      headers: { authorization: "Bearer qa-secret" },
      originalUrl: "/api/runs",
      path: "/api/runs",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    requireAuth(req, res as never, jest.fn());

    expect(verifyMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    warnSpy.mockRestore();
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
      audience: "legacy-client",
      issuer: "https://legacyciam.ciamlogin.com/legacy-tenant/v2.0",
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
      audience: "new-client",
      issuer: "https://newciam.ciamlogin.com/new-tenant/v2.0",
    });
    const [, keyResolver] = verifyMock.mock.calls[0];
    keyResolver({ kid: "new-kid" }, jest.fn());
    expect(jwksClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jwksUri: "https://newciam.ciamlogin.com/new-tenant/discovery/v2.0/keys",
      })
    );
  });

  it("uses a timing-safe comparison for the QA E2E bearer token", () => {
    process.env.QA_E2E_BEARER_TOKEN = "qa-secret";
    delete process.env.AZURE_TENANT_SUBDOMAIN;
    delete process.env.AZURE_TENANT_ID;
    delete process.env.AZURE_CLIENT_ID;
    delete process.env.AZURE_CIAM_TENANT_SUBDOMAIN;
    delete process.env.AZURE_CIAM_TENANT_ID;
    delete process.env.AZURE_CIAM_CLIENT_ID;

    const requireAuth = loadRequireAuth();
    const req = {
      headers: { authorization: "Bearer qa-secrex" },
      originalUrl: "/api/me",
      path: "/api/me",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    requireAuth(req, res as never, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.status).not.toHaveBeenCalledWith(200);
    warnSpy.mockRestore();
  });
});
