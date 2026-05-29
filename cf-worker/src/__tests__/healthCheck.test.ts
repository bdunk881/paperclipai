/**
 * Smoke test for the HealthCheckDO + worker entry. Runs against a real
 * miniflare-backed Workers runtime via @cloudflare/vitest-pool-workers,
 * so it exercises the actual DO binding rather than mocking it.
 *
 * This is the canonical "how to test a DO" example. HEL-291+ DOs should
 * follow the same shape: import { SELF } from "cloudflare:test"; make
 * a real fetch; assert on the response.
 */
import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("HealthCheckDO + worker entry", () => {
  it("returns ok=true on GET /__health", async () => {
    const res = await SELF.fetch("http://localhost/__health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(typeof body.ts).toBe("string");
    expect(typeof body.instanceId).toBe("string");
  });

  it("returns 404 for unknown paths", async () => {
    const res = await SELF.fetch("http://localhost/nope");
    expect(res.status).toBe(404);
  });

  it("returns 404 for non-GET on /__health", async () => {
    const res = await SELF.fetch("http://localhost/__health", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("returns deterministic instanceId across calls (singleton DO)", async () => {
    const first = await (await SELF.fetch("http://localhost/__health")).json();
    const second = await (await SELF.fetch("http://localhost/__health")).json();
    expect((first as { instanceId: string }).instanceId).toBe(
      (second as { instanceId: string }).instanceId,
    );
  });
});
