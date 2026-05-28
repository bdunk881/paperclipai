import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import {
  AAL2_ATTESTATION_COOKIE,
  buildAal2AttestationCookieHeader,
  mintAal2Attestation,
  requireAAL2,
  verifyAal2AttestationCookie,
} from "./requireAAL2";
import { __resetWorkspaceFlagCacheForTests } from "../security/workspaceFeatureFlags";

// HEL-298: workspaceFeatureFlags now reads through withWorkspaceContext,
// so the test simulates the BEGIN / set_config / SELECT / COMMIT sequence
// against the pool client. `flagRowQueue` is the next row(s) the SELECT
// inside the transaction should return; tests push a row to enable the
// override or leave the queue empty for "no override".
const flagRowQueue: Array<{ enabled: boolean; expires_at: Date | null } | null> = [];
const clientQueryMock = jest.fn(async (sql: string) => {
  if (sql.includes("FROM workspace_feature_overrides")) {
    const next = flagRowQueue.shift();
    return { rows: next ? [next] : [] };
  }
  // BEGIN, set_config(...), COMMIT, ROLLBACK
  return { rows: [] };
});
const connectMock = jest.fn(async () => ({
  query: clientQueryMock,
  release: jest.fn(),
}));

jest.mock("../db/postgres", () => ({
  isPostgresPersistenceEnabled: () => true,
  getPostgresPool: () => ({ connect: connectMock }),
}));

function createResponse() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { status, json } as unknown as Response;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function makeReq(opts: {
  sub?: string;
  aal?: "aal1" | "aal2";
  amr?: { method: string; timestamp: number }[];
  cookie?: string;
  provider?: string;
  workspaceId?: string;
}): AuthenticatedRequest {
  return {
    auth: opts.sub
      ? {
          sub: opts.sub,
          aal: opts.aal,
          amr: opts.amr,
          provider: opts.provider,
          workspaceId: opts.workspaceId,
        }
      : undefined,
    headers: opts.cookie
      ? { cookie: `${AAL2_ATTESTATION_COOKIE}=${opts.cookie}` }
      : {},
  } as unknown as AuthenticatedRequest;
}

const APP_JWT_SECRET_FOR_TESTS = "test-secret-key-at-least-32-bytes-long-please";

describe("requireAAL2", () => {
  const originalSecret = process.env.APP_JWT_SECRET;
  const originalTtl = process.env.MFA_STEP_UP_TTL_SECONDS;

  const originalBypass = process.env.MFA_DISABLE_AAL2_ENFORCEMENT;

  beforeEach(() => {
    process.env.APP_JWT_SECRET = APP_JWT_SECRET_FOR_TESTS;
    delete process.env.MFA_STEP_UP_TTL_SECONDS;
    // jest.env.cjs sets MFA_DISABLE_AAL2_ENFORCEMENT="true" so unrelated
    // tests don't have to stub this middleware. Delete it here so the
    // real gate behavior is verified by these tests.
    delete process.env.MFA_DISABLE_AAL2_ENFORCEMENT;
    clientQueryMock.mockReset();
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM workspace_feature_overrides")) {
        const next = flagRowQueue.shift();
        return { rows: next ? [next] : [] };
      }
      return { rows: [] };
    });
    connectMock.mockClear();
    flagRowQueue.length = 0;
    __resetWorkspaceFlagCacheForTests();
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.APP_JWT_SECRET;
    else process.env.APP_JWT_SECRET = originalSecret;
    if (originalTtl === undefined) delete process.env.MFA_STEP_UP_TTL_SECONDS;
    else process.env.MFA_STEP_UP_TTL_SECONDS = originalTtl;
    if (originalBypass === undefined) delete process.env.MFA_DISABLE_AAL2_ENFORCEMENT;
    else process.env.MFA_DISABLE_AAL2_ENFORCEMENT = originalBypass;
  });

  it("rejects unauthenticated requests with 401", async () => {
    const req = makeReq({});
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await requireAAL2(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("passes a Supabase JWT with aal=aal2 and a recent totp amr entry", async () => {
    const req = makeReq({
      sub: "user-1",
      aal: "aal2",
      amr: [{ method: "totp", timestamp: nowSeconds() - 30 }],
    });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await requireAAL2(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects aal=aal1 even with recent amr entries", async () => {
    const req = makeReq({
      sub: "user-1",
      aal: "aal1",
      amr: [{ method: "totp", timestamp: nowSeconds() }],
    });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await requireAAL2(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects an expired Supabase amr timestamp", async () => {
    const req = makeReq({
      sub: "user-1",
      aal: "aal2",
      amr: [{ method: "totp", timestamp: nowSeconds() - 60 * 60 }],
    });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await requireAAL2(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("passes when a fresh AAL2 attestation cookie matches the user", async () => {
    const minted = mintAal2Attestation({ userId: "user-1", method: "webauthn" });
    const req = makeReq({ sub: "user-1", aal: "aal1", cookie: minted.token });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await requireAAL2(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects an attestation cookie whose sub does not match req.auth.sub", async () => {
    const minted = mintAal2Attestation({ userId: "user-A", method: "webauthn" });
    const req = makeReq({ sub: "user-B", aal: "aal1", cookie: minted.token });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await requireAAL2(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects an expired attestation cookie", async () => {
    const minted = mintAal2Attestation({
      userId: "user-1",
      method: "webauthn",
      ttlSeconds: 1,
    });
    // Wait past expiry by reverse-mocking. Easiest: directly verify with a stale token
    // sleeping 1.2s would slow the test; instead build an already-expired one manually.
    const expiredAt = nowSeconds() - 120;
    const expired = require("jsonwebtoken").sign(
      { sub: "user-1", method: "webauthn", iat: expiredAt - 60, exp: expiredAt },
      APP_JWT_SECRET_FOR_TESTS,
      { audience: "autoflow-aal2", issuer: "autoflow-mfa" },
    );
    const verified = verifyAal2AttestationCookie(expired, "user-1");
    expect(verified.valid).toBe(false);

    const req = makeReq({ sub: "user-1", aal: "aal1", cookie: expired });
    const res = createResponse();
    const next = jest.fn() as NextFunction;
    await requireAAL2(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);

    // Keep `minted` in scope so the var isn't flagged.
    expect(typeof minted.token).toBe("string");
  });

  // HEL-280 --------------------------------------------------------------

  it("treats a google-provider session as AAL2 when the workspace flag is off", async () => {
    // No override row → workspace shortcut allows OAuth.
    flagRowQueue.length = 0;
    const req = makeReq({
      sub: "user-1",
      aal: "aal1",
      provider: "google",
      workspaceId: "ws-1",
    });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await requireAAL2(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("treats a github-provider session as AAL2 with no workspace bound", async () => {
    const req = makeReq({ sub: "user-1", aal: "aal1", provider: "github" });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await requireAAL2(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("requires app MFA for OAuth users when require_app_mfa_for_oauth_users is on", async () => {
    flagRowQueue.push({ enabled: true, expires_at: null });
    const req = makeReq({
      sub: "user-1",
      aal: "aal1",
      provider: "google",
      workspaceId: "ws-ent",
    });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await requireAAL2(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("does NOT shortcut for non-OAuth providers", async () => {
    const req = makeReq({
      sub: "user-1",
      aal: "aal1",
      provider: "email",
      workspaceId: "ws-1",
    });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await requireAAL2(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(connectMock).not.toHaveBeenCalled();
  });

  // HEL-298: prove async rejections from the workspace-flag check reach
  // next(err) instead of becoming an unhandled rejection.
  it("routes async rejections through next(err) instead of hanging", async () => {
    flagRowQueue.length = 0;
    // First call returns BEGIN OK, then trips an error on the next query
    // so the rejection surfaces from inside withWorkspaceContext.
    const originalImpl = clientQueryMock.getMockImplementation();
    clientQueryMock.mockImplementationOnce(async () => ({ rows: [] })); // BEGIN
    clientQueryMock.mockImplementationOnce(async () => {
      throw new Error("simulated postgres failure");
    });
    const req = makeReq({
      sub: "user-1",
      aal: "aal1",
      provider: "google",
      workspaceId: "ws-1",
    });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await requireAAL2(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "simulated postgres failure" }));
    if (originalImpl) clientQueryMock.mockImplementation(originalImpl);
  });

  it("emits a Set-Cookie value with the correct flags", () => {
    const header = buildAal2AttestationCookieHeader("abc.def.ghi", 900);
    expect(header).toContain(`${AAL2_ATTESTATION_COOKIE}=abc.def.ghi`);
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Max-Age=900");
  });
});
