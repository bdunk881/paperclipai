/**
 * HEL-427 — auth guard for the rate-limit routes.
 *
 * Pure-function checks for the bearer-token logic, plus integration checks
 * (via the real miniflare worker) that an unauthenticated POST is rejected.
 */
import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { isWorkerRequestAuthorized } from "../index";

describe("rate-limit auth guard (HEL-427)", () => {
  it("authorizes only a matching Bearer token", () => {
    expect(isWorkerRequestAuthorized("Bearer s3cr3t", "s3cr3t")).toBe(true);
    expect(isWorkerRequestAuthorized("Bearer wrong", "s3cr3t")).toBe(false);
    expect(isWorkerRequestAuthorized("s3cr3t", "s3cr3t")).toBe(false); // missing "Bearer " prefix
    expect(isWorkerRequestAuthorized("Bearer s3cr3t extra", "s3cr3t")).toBe(false);
    expect(isWorkerRequestAuthorized(null, "s3cr3t")).toBe(false);
  });

  it("fails closed when the secret is unset", () => {
    expect(isWorkerRequestAuthorized("Bearer anything", undefined)).toBe(false);
    expect(isWorkerRequestAuthorized("Bearer anything", "")).toBe(false);
  });

  it("rejects POST /rate-limit/consume without auth (401)", async () => {
    const res = await SELF.fetch("http://localhost/rate-limit/consume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "test", key: "k", limit: 5, windowMs: 1000 }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects POST /rate-limit/refund without auth (401)", async () => {
    const res = await SELF.fetch("http://localhost/rate-limit/refund", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "test", key: "k", limit: 5, windowMs: 1000 }),
    });
    expect(res.status).toBe(401);
  });
});
