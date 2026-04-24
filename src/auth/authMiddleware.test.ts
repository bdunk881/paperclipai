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

  it("supports branded CIAM authorities while keeping tenant subdomain issuer fallback", () => {
    process.env.AZURE_CIAM_AUTHORITY = "https://auth.helloautoflow.com/tenant-guid";
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
        "https://auth.helloautoflow.com/tenant-guid/v2.0",
        "https://autoflowciam.ciamlogin.com/tenant-guid/v2.0",
        "https://tenant-guid.ciamlogin.com/tenant-guid/v2.0",
      ]),
      algorithms: ["RS256"],
    });
    keyResolver({ kid: "brand-kid" }, jest.fn());
    expect(jwksClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jwksUri: "https://auth.helloautoflow.com/tenant-guid/discovery/v2.0/keys",
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
      audience: expect.arrayContaining(["new-client", "legacy-client"]),
      issuer: expect.arrayContaining([
        "https://newciam.ciamlogin.com/tenant-guid/v2.0",
        "https://tenant-guid.ciamlogin.com/tenant-guid/v2.0",
      ]),
    });
  });
});
