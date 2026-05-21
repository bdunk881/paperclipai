import { cachedWorkspaceRead, invalidateWorkspaceCache, isReadCacheEnabled } from "./readCache";
import { getRedisClient, resetRedisClientForTests } from "../queue/redisClient";

describe("readCache", () => {
  afterEach(() => {
    resetRedisClientForTests();
    delete process.env.AUTOFLOW_ALLOW_INMEMORY;
    delete process.env.REDIS_URL;
  });

  it("falls through to loader when Redis is not configured", async () => {
    const loader = jest.fn(async () => ({ ok: true }));
    const result = await cachedWorkspaceRead("ws-1", "home", 30, loader);
    expect(result).toEqual({ ok: true });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(isReadCacheEnabled()).toBe(false);
  });

  it("invalidateWorkspaceCache is a no-op when Redis is disabled", async () => {
    await expect(invalidateWorkspaceCache("ws-1", ["home"])).resolves.toBeUndefined();
  });
});
