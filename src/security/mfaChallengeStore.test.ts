/**
 * HEL-303: covers both backends of the MFA challenge store.
 *
 * The in-memory backend is exercised by the existing
 * `mfaService.test.ts` (which uses it by default via
 * `setMfaChallengeStoreForTests`). This file also asserts the
 * eviction + atomic-consume semantics directly, so a future tweak to
 * either backend can't silently break the contract.
 *
 * The Redis backend is mocked at the `RedisLike` interface level —
 * we hand in a stub that records the calls and stages return values.
 * Hitting a real Redis is the integration-test layer's job (out of
 * scope for this PR; HEL-70-style RLS tests already prove the Redis
 * client wiring works elsewhere).
 */

import {
  InMemoryMfaChallengeStore,
  MFA_CHALLENGE_TTL_SECONDS,
  RedisMfaChallengeStore,
  getDefaultMfaChallengeStore,
  setMfaChallengeStoreForTests,
  type RedisLike,
} from "./mfaChallengeStore";
import { isRedisConfigured, getRedisClient } from "../queue/redisClient";

jest.mock("../queue/redisClient");
const mockIsRedisConfigured = isRedisConfigured as jest.Mock;
const mockGetRedisClient = getRedisClient as jest.Mock;

describe("InMemoryMfaChallengeStore", () => {
  it("remembers then consumes a challenge atomically (single-use)", async () => {
    const store = new InMemoryMfaChallengeStore();
    await store.remember("reg:u-1", "chal-abc");
    expect(await store.consume("reg:u-1")).toBe("chal-abc");
    // Second consume MUST return null — double-submit safety.
    expect(await store.consume("reg:u-1")).toBeNull();
  });

  it("returns null for an unknown key", async () => {
    const store = new InMemoryMfaChallengeStore();
    expect(await store.consume("reg:does-not-exist")).toBeNull();
  });

  it("returns null after the TTL has elapsed", async () => {
    // 1-second TTL so the test doesn't have to wait the real 5 minutes.
    const store = new InMemoryMfaChallengeStore(1);
    await store.remember("reg:u-2", "chal-expired");

    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 2000;
      expect(await store.consume("reg:u-2")).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it("isolates challenges per key (registration vs assertion)", async () => {
    const store = new InMemoryMfaChallengeStore();
    await store.remember("reg:u-3", "challenge-reg");
    await store.remember("auth:u-3", "challenge-auth");

    expect(await store.consume("reg:u-3")).toBe("challenge-reg");
    // auth key untouched after consuming the reg key.
    expect(await store.consume("auth:u-3")).toBe("challenge-auth");
  });

  it("overwrites a stale challenge when remember is called again for the same key", async () => {
    const store = new InMemoryMfaChallengeStore();
    await store.remember("reg:u-4", "first-challenge");
    await store.remember("reg:u-4", "second-challenge");
    expect(await store.consume("reg:u-4")).toBe("second-challenge");
  });
});

describe("RedisMfaChallengeStore", () => {
  function makeMockClient(): RedisLike & {
    set: jest.Mock;
    get: jest.Mock;
    del: jest.Mock;
    call: jest.Mock;
  } {
    return {
      set: jest.fn(async () => "OK"),
      get: jest.fn(async () => null),
      del: jest.fn(async () => 1),
      call: jest.fn(async () => null),
    };
  }

  it("writes the challenge with the documented TTL and key prefix", async () => {
    const client = makeMockClient();
    const store = new RedisMfaChallengeStore(client);

    await store.remember("reg:u-1", "chal-fresh");

    expect(client.set).toHaveBeenCalledWith(
      "mfa:challenge:reg:u-1",
      "chal-fresh",
      "EX",
      MFA_CHALLENGE_TTL_SECONDS,
    );
  });

  it("uses GETDEL when available (atomic consume on Redis 6.2+)", async () => {
    const client = makeMockClient();
    client.call.mockResolvedValueOnce("chal-redis-getdel");

    const store = new RedisMfaChallengeStore(client);
    expect(await store.consume("reg:u-2")).toBe("chal-redis-getdel");
    expect(client.call).toHaveBeenCalledWith("GETDEL", "mfa:challenge:reg:u-2");
    // GETDEL was used — we should NOT have fallen through to GET + DEL.
    expect(client.get).not.toHaveBeenCalled();
    expect(client.del).not.toHaveBeenCalled();
  });

  it("returns null when GETDEL reports an empty/missing key", async () => {
    const client = makeMockClient();
    client.call.mockResolvedValueOnce(null);
    const store = new RedisMfaChallengeStore(client);
    expect(await store.consume("reg:u-missing")).toBeNull();
  });

  it("falls back to GET + DEL when GETDEL throws (older Redis)", async () => {
    const client = makeMockClient();
    client.call.mockRejectedValueOnce(new Error("ERR unknown command 'GETDEL'"));
    client.get.mockResolvedValueOnce("chal-redis-legacy");

    const store = new RedisMfaChallengeStore(client);
    expect(await store.consume("reg:u-3")).toBe("chal-redis-legacy");
    expect(client.get).toHaveBeenCalledWith("mfa:challenge:reg:u-3");
    expect(client.del).toHaveBeenCalledWith("mfa:challenge:reg:u-3");
  });

  it("does not DEL when the GET fallback returns null", async () => {
    const client = makeMockClient();
    client.call.mockRejectedValueOnce(new Error("ERR"));
    client.get.mockResolvedValueOnce(null);
    const store = new RedisMfaChallengeStore(client);
    expect(await store.consume("reg:u-4")).toBeNull();
    expect(client.del).not.toHaveBeenCalled();
  });

  // HEL-326 diagnostics ------------------------------------------------------

  it("warns when the SET did not persist (TTL read-back is negative)", async () => {
    const client = makeMockClient();
    client.ttl = jest.fn(async () => -2);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await new RedisMfaChallengeStore(client).remember("reg:u-5", "c");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("did not persist"));
    } finally {
      warn.mockRestore();
    }
  });

  it("surfaces a GETDEL NOPERM error (not swallowed) and falls back to GET+DEL", async () => {
    const client = makeMockClient();
    client.call.mockRejectedValueOnce(new Error("NOPERM this user has no permissions to run the 'getdel' command"));
    client.get.mockResolvedValueOnce("chal-after-noperm");
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await new RedisMfaChallengeStore(client).consume("reg:u-6")).toBe("chal-after-noperm");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("GETDEL unavailable"));
      expect(client.del).toHaveBeenCalledWith("mfa:challenge:reg:u-6");
    } finally {
      warn.mockRestore();
    }
  });

  it("logs miss forensics when consume returns null", async () => {
    const client = makeMockClient();
    client.call.mockResolvedValueOnce(null); // GETDEL → miss
    client.exists = jest.fn(async () => 0);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await new RedisMfaChallengeStore(client).consume("reg:u-7")).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("consume MISS"));
    } finally {
      warn.mockRestore();
    }
  });
});

describe("getDefaultMfaChallengeStore (HEL-326 fail-loud)", () => {
  const origNodeEnv = process.env.NODE_ENV;
  const origAllow = process.env.AUTOFLOW_ALLOW_INMEMORY;

  beforeEach(() => {
    jest.clearAllMocks();
    setMfaChallengeStoreForTests(null);
  });
  afterEach(() => {
    setMfaChallengeStoreForTests(null);
    process.env.NODE_ENV = origNodeEnv;
    if (origAllow === undefined) delete process.env.AUTOFLOW_ALLOW_INMEMORY;
    else process.env.AUTOFLOW_ALLOW_INMEMORY = origAllow;
  });

  it("returns the Redis-backed store when Redis is configured", () => {
    mockIsRedisConfigured.mockReturnValue(true);
    mockGetRedisClient.mockReturnValue({ set: jest.fn(), get: jest.fn(), del: jest.fn() });
    expect(getDefaultMfaChallengeStore()).toBeInstanceOf(RedisMfaChallengeStore);
  });

  it("THROWS in production when Redis is unconfigured (no silent in-memory fallback)", () => {
    mockIsRedisConfigured.mockReturnValue(false);
    process.env.NODE_ENV = "production";
    delete process.env.AUTOFLOW_ALLOW_INMEMORY;
    expect(() => getDefaultMfaChallengeStore()).toThrow(/requires Redis/i);
  });

  it("permits in-memory in production only when AUTOFLOW_ALLOW_INMEMORY=true", () => {
    mockIsRedisConfigured.mockReturnValue(false);
    process.env.NODE_ENV = "production";
    process.env.AUTOFLOW_ALLOW_INMEMORY = "true";
    expect(getDefaultMfaChallengeStore()).toBeInstanceOf(InMemoryMfaChallengeStore);
  });

  it("falls back to in-memory outside production (local dev / test)", () => {
    mockIsRedisConfigured.mockReturnValue(false);
    process.env.NODE_ENV = "test";
    expect(getDefaultMfaChallengeStore()).toBeInstanceOf(InMemoryMfaChallengeStore);
  });
});
