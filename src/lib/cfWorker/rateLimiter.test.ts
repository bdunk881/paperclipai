import { rateLimit, refundRateLimit } from "./rateLimiter";

const ORIGINAL_BASE_URL = process.env.CF_WORKER_BASE_URL;

describe("cf-worker rateLimiter client", () => {
  beforeEach(() => {
    process.env.CF_WORKER_BASE_URL = "https://worker.test.example";
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (ORIGINAL_BASE_URL === undefined) {
      delete process.env.CF_WORKER_BASE_URL;
    } else {
      process.env.CF_WORKER_BASE_URL = ORIGINAL_BASE_URL;
    }
  });

  it("returns the Durable Object decision on a successful consume call", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ allowed: false, remaining: 0, retryAfterMs: 25_000 }), {
        status: 200,
      }),
    );

    const result = await rateLimit({
      scope: "workspace",
      key: "workspace:test",
      limit: 1,
      windowMs: 60_000,
    });

    expect(result).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: 25_000,
      source: "durable-object",
    });
  });

  it("fails open when the Worker call fails", async () => {
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const result = await rateLimit({
      scope: "workspace",
      key: "workspace:test",
      limit: 5,
      windowMs: 60_000,
    });

    expect(result).toEqual({
      allowed: true,
      remaining: 5,
      retryAfterMs: 0,
      source: "fallback",
      errorReason: "network",
    });
  });

  it("fails closed when requested by a security-sensitive caller", async () => {
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const result = await rateLimit({
      scope: "auth",
      key: "ip:test",
      limit: 5,
      windowMs: 60_000,
      onFailure: "fail-closed",
    });

    expect(result).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: 60_000,
      source: "fallback",
      errorReason: "fail_closed",
    });
  });

  it("calls the refund endpoint for skipFailedRequests compatibility", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ refunded: true }), {
        status: 200,
      }),
    );

    await expect(
      refundRateLimit({
        scope: "billing-mutation",
        key: "workspace:test",
        limit: 5,
        windowMs: 86_400_000,
      }),
    ).resolves.toBe(true);
  });
});
