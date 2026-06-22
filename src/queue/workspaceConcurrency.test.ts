import {
  resolveWorkspaceConcurrencyLimit,
  acquireWorkspaceSlot,
  releaseWorkspaceSlot,
  type ConcurrencyRedis,
} from "./workspaceConcurrency";

function makeRedis(): ConcurrencyRedis & {
  store: Map<string, number>;
  expireCalls: () => number;
} {
  const store = new Map<string, number>();
  let expireCalls = 0;
  return {
    store,
    expireCalls: () => expireCalls,
    async incr(key: string) {
      const v = (store.get(key) ?? 0) + 1;
      store.set(key, v);
      return v;
    },
    async decr(key: string) {
      const v = (store.get(key) ?? 0) - 1;
      store.set(key, v);
      return v;
    },
    async expire() {
      expireCalls += 1;
      return 1;
    },
    async set(key: string, val: string) {
      store.set(key, Number(val));
      return "OK";
    },
  };
}

describe("resolveWorkspaceConcurrencyLimit (HEL-699)", () => {
  const original = process.env.RUN_WORKSPACE_CONCURRENCY;
  afterEach(() => {
    if (original === undefined) delete process.env.RUN_WORKSPACE_CONCURRENCY;
    else process.env.RUN_WORKSPACE_CONCURRENCY = original;
  });

  it("is 0 (disabled) when unset / non-numeric / <= 0", () => {
    delete process.env.RUN_WORKSPACE_CONCURRENCY;
    expect(resolveWorkspaceConcurrencyLimit()).toBe(0);
    process.env.RUN_WORKSPACE_CONCURRENCY = "abc";
    expect(resolveWorkspaceConcurrencyLimit()).toBe(0);
    process.env.RUN_WORKSPACE_CONCURRENCY = "0";
    expect(resolveWorkspaceConcurrencyLimit()).toBe(0);
    process.env.RUN_WORKSPACE_CONCURRENCY = "-3";
    expect(resolveWorkspaceConcurrencyLimit()).toBe(0);
  });

  it("reads a positive integer", () => {
    process.env.RUN_WORKSPACE_CONCURRENCY = "3";
    expect(resolveWorkspaceConcurrencyLimit()).toBe(3);
  });
});

describe("acquire/releaseWorkspaceSlot (HEL-699)", () => {
  it("admits up to the limit, then refuses without leaking a slot", async () => {
    const redis = makeRedis();
    expect(await acquireWorkspaceSlot(redis, "ws", 2)).toBe(true);
    expect(await acquireWorkspaceSlot(redis, "ws", 2)).toBe(true);
    expect(await acquireWorkspaceSlot(redis, "ws", 2)).toBe(false); // at cap
    expect(redis.store.get("runconc:ws")).toBe(2); // refused acquire decremented back
    expect(redis.expireCalls()).toBeGreaterThan(0); // TTL refreshed on acquire
  });

  it("release decrements and floors at 0", async () => {
    const redis = makeRedis();
    await acquireWorkspaceSlot(redis, "ws", 5);
    await acquireWorkspaceSlot(redis, "ws", 5); // count = 2
    await releaseWorkspaceSlot(redis, "ws"); // 1
    await releaseWorkspaceSlot(redis, "ws"); // 0
    await releaseWorkspaceSlot(redis, "ws"); // would be -1 → floored to 0
    expect(redis.store.get("runconc:ws")).toBe(0);
  });

  it("gives each workspace an independent budget", async () => {
    const redis = makeRedis();
    expect(await acquireWorkspaceSlot(redis, "a", 1)).toBe(true);
    expect(await acquireWorkspaceSlot(redis, "a", 1)).toBe(false); // a at cap
    expect(await acquireWorkspaceSlot(redis, "b", 1)).toBe(true); // b unaffected
  });
});
