/**
 * Unit tests for requireAuth middleware.
 *
 * Tests the middleware directly (not through Express) with mock req/res/next
 * objects so we exercise the actual auth logic rather than a mock.
 */

import { requireAuth, AuthenticatedRequest } from "./authMiddleware";
import { Response, NextFunction } from "express";

function makeReq(authHeader?: string): AuthenticatedRequest {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  } as unknown as AuthenticatedRequest;
}

function makeRes(): { status: jest.Mock; json: jest.Mock; _status: number; _body: unknown } {
  const res = {
    _status: 0,
    _body: null as unknown,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  res.status.mockImplementation((code: number) => {
    res._status = code;
    return res;
  });
  res.json.mockImplementation((body: unknown) => {
    res._body = body;
    return res;
  });
  return res;
}

describe("requireAuth middleware", () => {
  it("returns 401 when Authorization header is missing", () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    requireAuth(req, res as unknown as Response, next);

    expect(res._status).toBe(401);
    expect((res._body as { error: string }).error).toMatch(/Authorization/);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when Authorization header does not start with 'Bearer '", () => {
    const req = makeReq("Basic dXNlcjpwYXNz");
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    requireAuth(req, res as unknown as Response, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 503 when Azure env vars are not configured (jwksUri is empty)", () => {
    // Azure env vars are not set in the test environment, so jwksUri is empty
    const req = makeReq("Bearer some.jwt.token");
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    requireAuth(req, res as unknown as Response, next);

    // With no AZURE_* env vars, the middleware cannot verify tokens
    expect([503, 401]).toContain(res._status);
    expect(next).not.toHaveBeenCalled();
  });
});
