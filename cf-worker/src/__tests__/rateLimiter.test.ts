import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

interface RateLimitResponse {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

function consume(key: string, limit: number, windowMs: number): Promise<Response> {
  return SELF.fetch("http://localhost/rate-limit/consume", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: "Bearer test-shared-secret" },
    body: JSON.stringify({
      scope: "workspace",
      key,
      limit,
      windowMs,
    }),
  });
}

describe("RateLimiterDO + worker entry", () => {
  it("allows only the configured number of rapid requests for one key", async () => {
    const responses = await Promise.all(
      Array.from({ length: 100 }, () => consume("rapid-workspace", 80, 60_000)),
    );

    expect(responses.every((res) => res.status === 200)).toBe(true);
    const bodies = (await Promise.all(responses.map((res) => res.json()))) as RateLimitResponse[];
    expect(bodies.filter((body) => body.allowed)).toHaveLength(80);
    expect(bodies.filter((body) => !body.allowed)).toHaveLength(20);
    expect(bodies.filter((body) => !body.allowed).every((body) => body.retryAfterMs > 0)).toBe(
      true,
    );
  });

  it("isolates counters by deterministic DO key", async () => {
    const first = (await (await consume("isolated-a", 1, 60_000)).json()) as RateLimitResponse;
    const second = (await (await consume("isolated-a", 1, 60_000)).json()) as RateLimitResponse;
    const other = (await (await consume("isolated-b", 1, 60_000)).json()) as RateLimitResponse;

    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(0);
    expect(second.allowed).toBe(false);
    expect(other.allowed).toBe(true);
  });

  it("refunds a consumed hit for failed upstream requests", async () => {
    const allowed = (await (await consume("refund-workspace", 1, 60_000)).json()) as RateLimitResponse;
    expect(allowed.allowed).toBe(true);

    const refund = await SELF.fetch("http://localhost/rate-limit/refund", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer test-shared-secret" },
      body: JSON.stringify({
        scope: "workspace",
        key: "refund-workspace",
        limit: 1,
        windowMs: 60_000,
      }),
    });
    expect(refund.status).toBe(200);
    expect(await refund.json()).toEqual({ refunded: true });

    const afterRefund = (await (await consume("refund-workspace", 1, 60_000)).json()) as RateLimitResponse;
    expect(afterRefund.allowed).toBe(true);
  });

  it("returns 400 for invalid consume payloads", async () => {
    const res = await SELF.fetch("http://localhost/rate-limit/consume", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer test-shared-secret" },
      body: JSON.stringify({ scope: "workspace", key: "", limit: 0, windowMs: 60_000 }),
    });
    expect(res.status).toBe(400);
  });
});
