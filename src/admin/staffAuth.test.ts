import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import {
  __resetStaffIdsCacheForTests,
  isAutoflowStaff,
  requireStaff,
} from "./staffAuth";
import {
  AAL2_ATTESTATION_COOKIE,
  mintAal2Attestation,
} from "../middleware/requireAAL2";

const APP_JWT_SECRET = "test-secret-key-at-least-32-bytes-long-please";

function createResponse() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { status, json } as unknown as Response;
}

function makeReq(opts: {
  sub?: string;
  cookieToken?: string;
}): AuthenticatedRequest {
  return {
    auth: opts.sub ? { sub: opts.sub } : undefined,
    headers: opts.cookieToken
      ? { cookie: `${AAL2_ATTESTATION_COOKIE}=${opts.cookieToken}` }
      : {},
  } as unknown as AuthenticatedRequest;
}

describe("staffAuth", () => {
  const original = {
    staff: process.env.AUTOFLOW_STAFF_USER_IDS,
    secret: process.env.APP_JWT_SECRET,
    enforcement: process.env.MFA_STAFF_ENFORCEMENT,
    bypass: process.env.MFA_DISABLE_AAL2_ENFORCEMENT,
  };

  beforeEach(() => {
    __resetStaffIdsCacheForTests();
    process.env.AUTOFLOW_STAFF_USER_IDS = "staff-1,staff-2";
    process.env.APP_JWT_SECRET = APP_JWT_SECRET;
    delete process.env.MFA_STAFF_ENFORCEMENT;
    // jest.env.cjs defaults this to "true" for unrelated suites; delete
    // so the real staff gate (which uses verifyAal2AttestationCookie) is
    // verified end-to-end.
    delete process.env.MFA_DISABLE_AAL2_ENFORCEMENT;
  });

  afterAll(() => {
    process.env.AUTOFLOW_STAFF_USER_IDS = original.staff;
    if (original.secret === undefined) delete process.env.APP_JWT_SECRET;
    else process.env.APP_JWT_SECRET = original.secret;
    if (original.enforcement === undefined) delete process.env.MFA_STAFF_ENFORCEMENT;
    else process.env.MFA_STAFF_ENFORCEMENT = original.enforcement;
    if (original.bypass === undefined) delete process.env.MFA_DISABLE_AAL2_ENFORCEMENT;
    else process.env.MFA_DISABLE_AAL2_ENFORCEMENT = original.bypass;
    __resetStaffIdsCacheForTests();
  });

  describe("isAutoflowStaff", () => {
    it("returns true for an allowlisted id", () => {
      expect(isAutoflowStaff("staff-1")).toBe(true);
    });
    it("returns false for a non-allowlisted id", () => {
      expect(isAutoflowStaff("regular-user")).toBe(false);
    });
    it("returns false for null/undefined", () => {
      expect(isAutoflowStaff(null)).toBe(false);
      expect(isAutoflowStaff(undefined)).toBe(false);
    });
  });

  describe("requireStaff", () => {
    it("401s when no auth is present", () => {
      const req = makeReq({});
      const res = createResponse();
      const next = jest.fn() as NextFunction;
      requireStaff(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("403s when the user is not staff", () => {
      const req = makeReq({ sub: "regular-user" });
      const res = createResponse();
      const next = jest.fn() as NextFunction;
      requireStaff(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("requires an AAL2 cookie even for staff users", () => {
      const req = makeReq({ sub: "staff-1" });
      const res = createResponse();
      const next = jest.fn() as NextFunction;
      requireStaff(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("admits a staff user with a fresh passkey AAL2 cookie", () => {
      const minted = mintAal2Attestation({ userId: "staff-1", method: "webauthn" });
      const req = makeReq({ sub: "staff-1", cookieToken: minted.token });
      const res = createResponse();
      const next = jest.fn() as NextFunction;
      requireStaff(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it("rejects staff with a TOTP-only attestation (phish-resistance enforced)", () => {
      const minted = mintAal2Attestation({ userId: "staff-1", method: "totp" });
      const req = makeReq({ sub: "staff-1", cookieToken: minted.token });
      const res = createResponse();
      const next = jest.fn() as NextFunction;
      requireStaff(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("accepts a recovery code attestation for staff (break-glass)", () => {
      const minted = mintAal2Attestation({ userId: "staff-1", method: "recovery_code" });
      const req = makeReq({ sub: "staff-1", cookieToken: minted.token });
      const res = createResponse();
      const next = jest.fn() as NextFunction;
      requireStaff(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("MFA_STAFF_ENFORCEMENT=off bypasses the AAL2 gate (break-glass)", () => {
      process.env.MFA_STAFF_ENFORCEMENT = "off";
      const req = makeReq({ sub: "staff-1" });
      const res = createResponse();
      const next = jest.fn() as NextFunction;
      requireStaff(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
