import type { Response } from "express";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import { AAL2_ATTESTATION_COOKIE, mintAal2Attestation } from "./requireAAL2";
import { requireWebAuthnAal2 } from "./requireWebAuthnAal2";

const clientQueryMock = jest.fn(async () => ({ rows: [] }));
const connectMock = jest.fn(async () => ({
  query: clientQueryMock,
  release: jest.fn(),
}));
jest.mock("../db/postgres", () => ({
  isPostgresPersistenceEnabled: () => true,
  getPostgresPool: () => ({ connect: connectMock }),
}));

function createResponse() {
  const status = jest.fn();
  const json = jest.fn();
  const headersSent = false;
  status.mockImplementation(() => ({ json }));
  return {
    res: { status, json, headersSent } as unknown as Response,
    status,
    json,
  };
}

function makeReq(opts: {
  sub?: string;
  cookie?: string;
  amr?: { method: string; timestamp: number }[];
  aal?: "aal1" | "aal2";
}): AuthenticatedRequest {
  return {
    auth: opts.sub ? { sub: opts.sub, aal: opts.aal, amr: opts.amr } : undefined,
    headers: opts.cookie ? { cookie: `${AAL2_ATTESTATION_COOKIE}=${opts.cookie}` } : {},
  } as unknown as AuthenticatedRequest;
}

const APP_JWT_SECRET_FOR_TESTS = "test-secret-key-at-least-32-bytes-long-please";

describe("requireWebAuthnAal2", () => {
  const originalSecret = process.env.APP_JWT_SECRET;
  beforeEach(() => {
    process.env.APP_JWT_SECRET = APP_JWT_SECRET_FOR_TESTS;
    delete process.env.MFA_AAL2_ENFORCEMENT;
    clientQueryMock.mockClear();
    connectMock.mockClear();
  });
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.APP_JWT_SECRET;
    else process.env.APP_JWT_SECRET = originalSecret;
  });

  it("passes a request whose AAL2 cookie was minted via webauthn", async () => {
    const { token } = mintAal2Attestation({ userId: "u1", method: "webauthn" });
    const req = makeReq({ sub: "u1", cookie: token });
    const { res, status } = createResponse();
    const next = jest.fn();
    await requireWebAuthnAal2(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it("rejects a request whose AAL2 cookie was minted via TOTP", async () => {
    const { token } = mintAal2Attestation({ userId: "u1", method: "totp" });
    const req = makeReq({ sub: "u1", cookie: token });
    const { res, status, json } = createResponse();
    const next = jest.fn();
    await requireWebAuthnAal2(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "mfa_step_up_required",
        reason: "staff_requires_passkey",
      }),
    );
  });

  it("rejects a request whose AAL2 cookie was minted via recovery_code", async () => {
    const { token } = mintAal2Attestation({ userId: "u1", method: "recovery_code" });
    const req = makeReq({ sub: "u1", cookie: token });
    const { res, status, json } = createResponse();
    const next = jest.fn();
    await requireWebAuthnAal2(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "staff_requires_passkey" }),
    );
  });

  it("rejects an unauthenticated request", async () => {
    const req = makeReq({});
    const { res, status } = createResponse();
    const next = jest.fn();
    await requireWebAuthnAal2(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it("rejects when no AAL2 cookie is present", async () => {
    const req = makeReq({ sub: "u1" });
    const { res, status } = createResponse();
    const next = jest.fn();
    await requireWebAuthnAal2(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });
});
