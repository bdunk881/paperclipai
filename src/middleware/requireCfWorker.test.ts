import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { type CfWorkerRequest, requireCfWorker } from "./requireCfWorker";

const SECRET = "test-shared-secret-32-chars-long-abc";
const AUDIENCE = "autoflow-api-internal";

const ORIGINAL_ENV = {
  secret: process.env.CF_WORKER_SHARED_SECRET,
  audience: process.env.CF_WORKER_INTERNAL_JWT_AUDIENCE,
};

function mockRes(): Response {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response;
}

function reqWithAuth(authHeader?: string): Request {
  return { headers: authHeader ? { authorization: authHeader } : {} } as unknown as Request;
}

function makeToken(overrides: Partial<jwt.SignOptions & { secret?: string; payload?: Record<string, unknown> }> = {}): string {
  const { secret, payload, ...rest } = overrides;
  const baseOptions: jwt.SignOptions = {
    algorithm: "HS256",
    issuer: "cf-worker",
    audience: AUDIENCE,
    subject: "rate-limiter",
    expiresIn: 15,
    ...rest,
  };
  return jwt.sign(payload ?? {}, secret ?? SECRET, baseOptions);
}

describe("requireCfWorker", () => {
  beforeEach(() => {
    process.env.CF_WORKER_SHARED_SECRET = SECRET;
    process.env.CF_WORKER_INTERNAL_JWT_AUDIENCE = AUDIENCE;
  });

  afterAll(() => {
    if (ORIGINAL_ENV.secret === undefined) delete process.env.CF_WORKER_SHARED_SECRET;
    else process.env.CF_WORKER_SHARED_SECRET = ORIGINAL_ENV.secret;
    if (ORIGINAL_ENV.audience === undefined) delete process.env.CF_WORKER_INTERNAL_JWT_AUDIENCE;
    else process.env.CF_WORKER_INTERNAL_JWT_AUDIENCE = ORIGINAL_ENV.audience;
  });

  it("503s when CF_WORKER_SHARED_SECRET is unset", () => {
    delete process.env.CF_WORKER_SHARED_SECRET;
    const res = mockRes();
    const next = jest.fn() as unknown as NextFunction;
    requireCfWorker(reqWithAuth(`Bearer ${makeToken()}`), res, next);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  it("401s when no Authorization header is present", () => {
    const res = mockRes();
    const next = jest.fn() as unknown as NextFunction;
    requireCfWorker(reqWithAuth(undefined), res, next);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
  });

  it("401s when the bearer scheme is wrong", () => {
    const res = mockRes();
    const next = jest.fn() as unknown as NextFunction;
    requireCfWorker(reqWithAuth("Basic blah"), res, next);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
  });

  it("passes a valid token through and populates req.cfWorker", () => {
    const token = makeToken();
    const req = reqWithAuth(`Bearer ${token}`);
    const res = mockRes();
    const next = jest.fn() as unknown as NextFunction;
    requireCfWorker(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((res as unknown as { statusCode: number }).statusCode).toBe(0);
    expect((req as CfWorkerRequest).cfWorker?.sub).toBe("rate-limiter");
    expect((req as CfWorkerRequest).cfWorker?.iss).toBe("cf-worker");
    expect((req as CfWorkerRequest).cfWorker?.aud).toBe(AUDIENCE);
  });

  it("401s on expired tokens", () => {
    const token = makeToken({ expiresIn: -10 });
    const res = mockRes();
    const next = jest.fn() as unknown as NextFunction;
    requireCfWorker(reqWithAuth(`Bearer ${token}`), res, next);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("401s on wrong issuer", () => {
    const token = makeToken({ issuer: "someone-else" });
    const res = mockRes();
    const next = jest.fn() as unknown as NextFunction;
    requireCfWorker(reqWithAuth(`Bearer ${token}`), res, next);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
  });

  it("401s on wrong audience", () => {
    const token = makeToken({ audience: "wrong-audience" });
    const res = mockRes();
    const next = jest.fn() as unknown as NextFunction;
    requireCfWorker(reqWithAuth(`Bearer ${token}`), res, next);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
  });

  it("401s on bad signature", () => {
    const token = makeToken({ secret: "different-secret-bytes-here-1234567" });
    const res = mockRes();
    const next = jest.fn() as unknown as NextFunction;
    requireCfWorker(reqWithAuth(`Bearer ${token}`), res, next);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
  });

  it("401s on lifetime > 30s cap", () => {
    const token = makeToken({ expiresIn: 60 });
    const res = mockRes();
    const next = jest.fn() as unknown as NextFunction;
    requireCfWorker(reqWithAuth(`Bearer ${token}`), res, next);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
    expect((res as unknown as { body: { error: string } }).body.error).toMatch(/30s cap/);
  });
});
