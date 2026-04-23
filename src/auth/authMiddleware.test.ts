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

  it("accepts the shared QA E2E bearer token on preview/staging deployments", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.QA_E2E_BEARER_TOKEN = "qa-shared-secret";

    const requireAuth = loadRequireAuth();
    const req = {
      headers: { authorization: "Bearer qa-shared-secret" },
      originalUrl: "/api/me",
      path: "/api/me",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();
    const next = jest.fn();

    requireAuth(req, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth).toMatchObject({
      sub: "qa-e2e-preview",
      email: "qa-e2e@autoflow.local",
      name: "QA E2E Preview",
    });
    expect(verifyMock).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("falls back to the preview access token when no dedicated QA E2E token is configured", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.QA_PREVIEW_ACCESS_TOKEN = "preview-shared-secret";
    delete process.env.QA_E2E_BEARER_TOKEN;

    const requireAuth = loadRequireAuth();
    const req = {
      headers: { authorization: "Bearer preview-shared-secret" },
      originalUrl: "/api/me",
      path: "/api/me",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    requireAuth(req, res as never, jest.fn());

    expect(req.auth).toMatchObject({
      sub: "qa-e2e-preview",
      email: "qa-e2e@autoflow.local",
      name: "QA E2E Preview",
    });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("does not enable the QA E2E bypass on production deployments", () => {
    process.env.VERCEL_ENV = "production";
    process.env.QA_E2E_BEARER_TOKEN = "qa-shared-secret";
    process.env.AZURE_CIAM_TENANT_SUBDOMAIN = "newciam";
    process.env.AZURE_CIAM_TENANT_ID = "new-tenant";
    process.env.AZURE_CIAM_CLIENT_ID = "new-client";

    const requireAuth = loadRequireAuth();
    const req = {
      headers: { authorization: "Bearer qa-shared-secret" },
      originalUrl: "/api/me",
      path: "/api/me",
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    requireAuth(req, res as never, jest.fn());

    expect(verifyMock).toHaveBeenCalledTimes(1);
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
});
