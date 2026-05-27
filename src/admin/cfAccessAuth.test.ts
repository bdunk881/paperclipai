import type { NextFunction, Request, Response } from "express";
import { requireCfAccess, verifyCfAccessAssertion } from "./cfAccessAuth";

function createResponse() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { status, json } as unknown as Response;
}

function makeReq(opts: { header?: string; cookie?: string; internalToken?: string }): Request {
  const headers: Record<string, string> = {};
  if (opts.header) headers["cf-access-jwt-assertion"] = opts.header;
  if (opts.cookie) headers.cookie = `CF_Authorization=${opts.cookie}`;
  if (opts.internalToken) headers["x-autoflow-internal-token"] = opts.internalToken;
  return { headers } as unknown as Request;
}

describe("requireCfAccess", () => {
  const original = {
    aud: process.env.CF_ACCESS_AUD_TAG,
    team: process.env.CF_ACCESS_TEAM_DOMAIN,
    bypass: process.env.CF_ACCESS_INTERNAL_BYPASS_TOKEN,
  };

  afterEach(() => {
    process.env.CF_ACCESS_AUD_TAG = original.aud;
    process.env.CF_ACCESS_TEAM_DOMAIN = original.team;
    process.env.CF_ACCESS_INTERNAL_BYPASS_TOKEN = original.bypass;
  });

  it("passes through when CF Access is not configured (dev/test)", () => {
    delete process.env.CF_ACCESS_AUD_TAG;
    delete process.env.CF_ACCESS_TEAM_DOMAIN;
    const req = makeReq({});
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    requireCfAccess(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects when CF Access is configured but no assertion is present", () => {
    process.env.CF_ACCESS_AUD_TAG = "aud-tag-123";
    process.env.CF_ACCESS_TEAM_DOMAIN = "autoflow";
    const req = makeReq({});
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    requireCfAccess(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("admits a request with a valid internal bypass token", () => {
    process.env.CF_ACCESS_AUD_TAG = "aud-tag-123";
    process.env.CF_ACCESS_TEAM_DOMAIN = "autoflow";
    process.env.CF_ACCESS_INTERNAL_BYPASS_TOKEN = "internal-secret";
    const req = makeReq({ internalToken: "internal-secret" });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    requireCfAccess(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects a request that presents the wrong bypass token", () => {
    process.env.CF_ACCESS_AUD_TAG = "aud-tag-123";
    process.env.CF_ACCESS_TEAM_DOMAIN = "autoflow";
    process.env.CF_ACCESS_INTERNAL_BYPASS_TOKEN = "internal-secret";
    const req = makeReq({ internalToken: "wrong-token" });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    requireCfAccess(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("verifyCfAccessAssertion fails closed when env is missing", async () => {
    delete process.env.CF_ACCESS_AUD_TAG;
    delete process.env.CF_ACCESS_TEAM_DOMAIN;
    const result = await verifyCfAccessAssertion("not.a.real.token");
    expect(result.valid).toBe(false);
  });
});
