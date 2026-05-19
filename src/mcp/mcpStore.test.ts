/**
 * Unit tests for the MCP server registry. DASH-50: store methods are async.
 */

import { mcpStore } from "./mcpStore";

beforeEach(async () => {
  await mcpStore._clear();
});

const uid = "user-1";
const base = { name: "My MCP", url: "https://mcp.example.com" };

describe("mcpStore.add", () => {
  it("creates a server and returns a public view", async () => {
    const s = await mcpStore.add(uid, base);
    expect(s.id).toBeDefined();
    expect(s.name).toBe("My MCP");
    expect(s.url).toBe("https://mcp.example.com");
    expect(s.userId).toBe(uid);
    expect(s.hasAuth).toBe(false);
  });

  it("strips trailing slash from url", async () => {
    const s = await mcpStore.add(uid, { name: "x", url: "https://mcp.example.com/" });
    expect(s.url).toBe("https://mcp.example.com");
  });

  it("sets hasAuth=true when auth header fields provided", async () => {
    const s = await mcpStore.add(uid, {
      ...base,
      authHeaderKey: "Authorization",
      authHeaderValue: "Bearer token",
    });
    expect(s.hasAuth).toBe(true);
  });

  it("does NOT expose authHeaderValue in the returned object", async () => {
    const s = await mcpStore.add(uid, {
      ...base,
      authHeaderKey: "Authorization",
      authHeaderValue: "secret",
    });
    expect((s as Record<string, unknown>).authHeaderValue).toBeUndefined();
  });

  it("sets createdAt as an ISO timestamp", async () => {
    const s = await mcpStore.add(uid, base);
    expect(() => new Date(s.createdAt)).not.toThrow();
  });
});

describe("mcpStore.list", () => {
  it("returns only servers for the given user", async () => {
    await mcpStore.add(uid, base);
    await mcpStore.add("other-user", { name: "other", url: "https://other.com" });
    expect((await mcpStore.list(uid)).length).toBe(1);
  });

  it("returns servers sorted by createdAt ascending", async () => {
    const a = await mcpStore.add(uid, { name: "A", url: "https://a.com" });
    const b = await mcpStore.add(uid, { name: "B", url: "https://b.com" });
    const list = await mcpStore.list(uid);
    expect(list[0].id).toBe(a.id);
    expect(list[1].id).toBe(b.id);
  });

  it("returns empty array when no servers", async () => {
    expect(await mcpStore.list(uid)).toEqual([]);
  });
});

describe("mcpStore.get", () => {
  it("returns the full server record (including authHeaderValue)", async () => {
    const s = await mcpStore.add(uid, {
      ...base,
      authHeaderKey: "Authorization",
      authHeaderValue: "secret",
    });
    const full = await mcpStore.get(s.id);
    expect(full).toBeDefined();
    expect(full!.authHeaderValue).toBe("secret");
  });

  it("returns undefined for unknown id", async () => {
    expect(await mcpStore.get("nope")).toBeUndefined();
  });
});

describe("mcpStore.remove", () => {
  it("removes a server and returns true", async () => {
    const s = await mcpStore.add(uid, base);
    expect(await mcpStore.remove(s.id, uid)).toBe(true);
    expect((await mcpStore.list(uid)).length).toBe(0);
  });

  it("returns false for unknown id", async () => {
    expect(await mcpStore.remove("no-such-id", uid)).toBe(false);
  });

  it("returns false when userId does not match", async () => {
    const s = await mcpStore.add(uid, base);
    expect(await mcpStore.remove(s.id, "wrong-user")).toBe(false);
    expect((await mcpStore.list(uid)).length).toBe(1);
  });
});
