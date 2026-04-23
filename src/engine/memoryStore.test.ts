/**
 * Unit tests for the in-memory context memory store.
 */

import { memoryStore } from "./memoryStore";

beforeEach(() => {
  memoryStore.clear();
});

const uid = "user-abc";
const base = { userId: uid, key: "preference", text: "dark mode enabled" };

describe("memoryStore.write — create", () => {
  it("creates an entry and returns it", () => {
    const entry = memoryStore.write(base);
    expect(entry.id).toBeDefined();
    expect(entry.userId).toBe(uid);
    expect(entry.key).toBe("preference");
    expect(entry.text).toBe("dark mode enabled");
  });

  it("sets createdAt and updatedAt as ISO strings", () => {
    const entry = memoryStore.write(base);
    expect(() => new Date(entry.createdAt)).not.toThrow();
    expect(() => new Date(entry.updatedAt)).not.toThrow();
  });

  it("sets expiresAt when ttlSeconds provided", () => {
    const entry = memoryStore.write({ ...base, ttlSeconds: 3600 });
    expect(entry.expiresAt).toBeDefined();
    const exp = new Date(entry.expiresAt!).getTime();
    expect(exp).toBeGreaterThan(Date.now());
  });

  it("does not set expiresAt when ttlSeconds omitted", () => {
    const entry = memoryStore.write(base);
    expect(entry.expiresAt).toBeUndefined();
  });
});

describe("memoryStore.write — upsert", () => {
  it("updates an existing entry with the same scope+key", () => {
    const first = memoryStore.write(base);
    const second = memoryStore.write({ ...base, text: "light mode" });
    expect(second.id).toBe(first.id);
    expect(second.text).toBe("light mode");
  });

  it("does NOT upsert when workflowId differs", () => {
    memoryStore.write({ ...base, workflowId: "wf-1" });
    memoryStore.write({ ...base, workflowId: "wf-2" });
    expect(memoryStore.list(uid).length).toBe(2);
  });
});

describe("memoryStore.search", () => {
  beforeEach(() => {
    memoryStore.write({ userId: uid, key: "color", text: "user likes blue and green" });
    memoryStore.write({ userId: uid, key: "food", text: "user prefers pizza" });
    memoryStore.write({ userId: "other-user", key: "color", text: "red" });
  });

  it("only returns entries for the given userId", () => {
    const results = memoryStore.search("blue", uid);
    expect(results.every((r) => r.entry.userId === uid)).toBe(true);
  });

  it("scores matching entries above zero", () => {
    const results = memoryStore.search("blue", uid);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("returns all entries sorted by recency when query is empty", () => {
    const results = memoryStore.search("", uid);
    expect(results.length).toBe(2);
  });

  it("filters by agentId when provided", () => {
    memoryStore.write({ userId: uid, key: "ctx", text: "agent context", agentId: "agent-1" });
    const results = memoryStore.search("", uid, "agent-1");
    expect(results.length).toBe(1);
    expect(results[0].entry.agentId).toBe("agent-1");
  });

  it("respects the limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      memoryStore.write({ userId: uid, key: `key-${i}`, text: "extra" });
    }
    const results = memoryStore.search("", uid, undefined, 3);
    expect(results.length).toBe(3);
  });
});

describe("memoryStore.get", () => {
  it("returns the entry by id", () => {
    const entry = memoryStore.write(base);
    expect(memoryStore.get(entry.id)).toEqual(entry);
  });

  it("returns undefined for an unknown id", () => {
    expect(memoryStore.get("no-such-id")).toBeUndefined();
  });
});

describe("memoryStore.list", () => {
  it("returns entries for the given user", () => {
    memoryStore.write(base);
    memoryStore.write({ userId: "other", key: "x", text: "y" });
    expect(memoryStore.list(uid).length).toBe(1);
  });

  it("filters by workflowId when provided", () => {
    memoryStore.write({ ...base, workflowId: "wf-1" });
    memoryStore.write({ ...base, key: "other", workflowId: "wf-2" });
    expect(memoryStore.list(uid, "wf-1").length).toBe(1);
  });
});

describe("memoryStore.delete", () => {
  it("removes an entry and returns true", () => {
    const entry = memoryStore.write(base);
    expect(memoryStore.delete(entry.id, uid)).toBe(true);
    expect(memoryStore.get(entry.id)).toBeUndefined();
  });

  it("returns false for an unknown id", () => {
    expect(memoryStore.delete("nope", uid)).toBe(false);
  });

  it("returns false when userId does not match", () => {
    const entry = memoryStore.write(base);
    expect(memoryStore.delete(entry.id, "wrong-user")).toBe(false);
    expect(memoryStore.get(entry.id)).toBeDefined();
  });
});

describe("memoryStore.stats", () => {
  it("returns correct counts for a user", () => {
    memoryStore.write({ userId: uid, key: "a", text: "hello", workflowId: "wf-1" });
    memoryStore.write({ userId: uid, key: "b", text: "world", workflowId: "wf-2" });
    memoryStore.write({ userId: "other", key: "c", text: "ignored" });
    const stats = memoryStore.stats(uid);
    expect(stats.totalEntries).toBe(2);
    expect(stats.workflowCount).toBe(2);
    expect(stats.totalBytes).toBeGreaterThan(0);
  });

  it("returns zero counts for a user with no entries", () => {
    const stats = memoryStore.stats("nobody");
    expect(stats.totalEntries).toBe(0);
    expect(stats.totalBytes).toBe(0);
    expect(stats.workflowCount).toBe(0);
  });
});

describe("memoryStore TTL expiry", () => {
  it("hides expired entries from get()", () => {
    jest.useFakeTimers();
    const entry = memoryStore.write({ ...base, ttlSeconds: 1 });
    jest.advanceTimersByTime(2000);
    expect(memoryStore.get(entry.id)).toBeUndefined();
    jest.useRealTimers();
  });

  it("excludes expired entries from list()", () => {
    jest.useFakeTimers();
    memoryStore.write({ ...base, ttlSeconds: 1 });
    jest.advanceTimersByTime(2000);
    expect(memoryStore.list(uid).length).toBe(0);
    jest.useRealTimers();
  });
});
