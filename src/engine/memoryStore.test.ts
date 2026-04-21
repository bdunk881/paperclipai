/**
 * Unit tests for the in-memory context memory store.
 */

import { memoryStore } from "./memoryStore";

beforeEach(() => {
  void memoryStore.clear();
});

const uid = "user-abc";
const base = { userId: uid, key: "preference", text: "dark mode enabled" };

describe("memoryStore.write — create", () => {
  it("creates an entry and returns it", async () => {
    const entry = await memoryStore.write(base);
    expect(entry.id).toBeDefined();
    expect(entry.userId).toBe(uid);
    expect(entry.key).toBe("preference");
    expect(entry.text).toBe("dark mode enabled");
  });

  it("sets createdAt and updatedAt as ISO strings", async () => {
    const entry = await memoryStore.write(base);
    expect(() => new Date(entry.createdAt)).not.toThrow();
    expect(() => new Date(entry.updatedAt)).not.toThrow();
  });

  it("sets expiresAt when ttlSeconds provided", async () => {
    const entry = await memoryStore.write({ ...base, ttlSeconds: 3600 });
    expect(entry.expiresAt).toBeDefined();
    const exp = new Date(entry.expiresAt!).getTime();
    expect(exp).toBeGreaterThan(Date.now());
  });

  it("does not set expiresAt when ttlSeconds omitted", async () => {
    const entry = await memoryStore.write(base);
    expect(entry.expiresAt).toBeUndefined();
  });
});

describe("memoryStore.write — upsert", () => {
  it("updates an existing entry with the same scope+key", async () => {
    const first = await memoryStore.write(base);
    const second = await memoryStore.write({ ...base, text: "light mode" });
    expect(second.id).toBe(first.id);
    expect(second.text).toBe("light mode");
  });

  it("does NOT upsert when workflowId differs", async () => {
    await memoryStore.write({ ...base, workflowId: "wf-1" });
    await memoryStore.write({ ...base, workflowId: "wf-2" });
    await expect(memoryStore.list(uid)).resolves.toHaveLength(2);
  });
});

describe("memoryStore.search", () => {
  beforeEach(async () => {
    await memoryStore.write({ userId: uid, key: "color", text: "user likes blue and green" });
    await memoryStore.write({ userId: uid, key: "food", text: "user prefers pizza" });
    await memoryStore.write({ userId: "other-user", key: "color", text: "red" });
  });

  it("only returns entries for the given userId", async () => {
    const results = await memoryStore.search("blue", uid);
    expect(results.every((r) => r.entry.userId === uid)).toBe(true);
  });

  it("scores matching entries above zero", async () => {
    const results = await memoryStore.search("blue", uid);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("returns all entries sorted by recency when query is empty", async () => {
    const results = await memoryStore.search("", uid);
    expect(results.length).toBe(2);
  });

  it("filters by agentId when provided", async () => {
    await memoryStore.write({ userId: uid, key: "ctx", text: "agent context", agentId: "agent-1" });
    const results = await memoryStore.search("", uid, "agent-1");
    expect(results.length).toBe(1);
    expect(results[0].entry.agentId).toBe("agent-1");
  });

  it("respects the limit parameter", async () => {
    for (let i = 0; i < 5; i += 1) {
      await memoryStore.write({ userId: uid, key: `key-${i}`, text: "extra" });
    }
    const results = await memoryStore.search("", uid, undefined, 3);
    expect(results.length).toBe(3);
  });
});

describe("memoryStore.get", () => {
  it("returns the entry by id", async () => {
    const entry = await memoryStore.write(base);
    await expect(memoryStore.get(entry.id)).resolves.toEqual(entry);
  });

  it("returns undefined for an unknown id", async () => {
    await expect(memoryStore.get("no-such-id")).resolves.toBeUndefined();
  });
});

describe("memoryStore.list", () => {
  it("returns entries for the given user", async () => {
    await memoryStore.write(base);
    await memoryStore.write({ userId: "other", key: "x", text: "y" });
    await expect(memoryStore.list(uid)).resolves.toHaveLength(1);
  });

  it("filters by workflowId when provided", async () => {
    await memoryStore.write({ ...base, workflowId: "wf-1" });
    await memoryStore.write({ ...base, key: "other", workflowId: "wf-2" });
    await expect(memoryStore.list(uid, "wf-1")).resolves.toHaveLength(1);
  });
});

describe("memoryStore.delete", () => {
  it("removes an entry and returns true", async () => {
    const entry = await memoryStore.write(base);
    await expect(memoryStore.delete(entry.id, uid)).resolves.toBe(true);
    await expect(memoryStore.get(entry.id)).resolves.toBeUndefined();
  });

  it("returns false for an unknown id", async () => {
    await expect(memoryStore.delete("nope", uid)).resolves.toBe(false);
  });

  it("returns false when userId does not match", async () => {
    const entry = await memoryStore.write(base);
    await expect(memoryStore.delete(entry.id, "wrong-user")).resolves.toBe(false);
    await expect(memoryStore.get(entry.id)).resolves.toBeDefined();
  });
});

describe("memoryStore.stats", () => {
  it("returns correct counts for a user", async () => {
    await memoryStore.write({ userId: uid, key: "a", text: "hello", workflowId: "wf-1" });
    await memoryStore.write({ userId: uid, key: "b", text: "world", workflowId: "wf-2" });
    await memoryStore.write({ userId: "other", key: "c", text: "ignored" });
    await expect(memoryStore.stats(uid)).resolves.toMatchObject({
      totalEntries: 2,
      workflowCount: 2,
    });
  });

  it("returns zero counts for a user with no entries", async () => {
    await expect(memoryStore.stats("nobody")).resolves.toEqual({
      totalEntries: 0,
      totalBytes: 0,
      workflowCount: 0,
    });
  });
});

describe("memoryStore TTL expiry", () => {
  it("hides expired entries from get()", async () => {
    jest.useFakeTimers();
    const entry = await memoryStore.write({ ...base, ttlSeconds: 1 });
    jest.advanceTimersByTime(2000);
    await expect(memoryStore.get(entry.id)).resolves.toBeUndefined();
    jest.useRealTimers();
  });

  it("excludes expired entries from list()", async () => {
    jest.useFakeTimers();
    await memoryStore.write({ ...base, ttlSeconds: 1 });
    jest.advanceTimersByTime(2000);
    await expect(memoryStore.list(uid)).resolves.toHaveLength(0);
    jest.useRealTimers();
  });
});
