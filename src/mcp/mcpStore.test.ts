/**
 * Unit tests for the in-memory MCP server registry.
 */

import { mcpStore } from "./mcpStore";

beforeEach(() => {
  mcpStore._clear();
});

const uid = "user-1";
const base = { name: "My MCP", url: "https://mcp.example.com" };

describe("mcpStore.add", () => {
  it("creates a server and returns a public view", () => {
    const s = mcpStore.add(uid, base);
    expect(s.id).toBeDefined();
    expect(s.name).toBe("My MCP");
    expect(s.url).toBe("https://mcp.example.com");
    expect(s.userId).toBe(uid);
    expect(s.hasAuth).toBe(false);
  });

  it("strips trailing slash from url", () => {
    const s = mcpStore.add(uid, { name: "x", url: "https://mcp.example.com/" });
    expect(s.url).toBe("https://mcp.example.com");
  });

  it("sets hasAuth=true when auth header fields provided", () => {
    const s = mcpStore.add(uid, {
      ...base,
      authHeaderKey: "Authorization",
      authHeaderValue: "Bearer token",
    });
    expect(s.hasAuth).toBe(true);
  });

  it("does NOT expose authHeaderValue in the returned object", () => {
    const s = mcpStore.add(uid, {
      ...base,
      authHeaderKey: "Authorization",
      authHeaderValue: "secret",
    });
    expect((s as Record<string, unknown>).authHeaderValue).toBeUndefined();
  });

  it("sets createdAt as an ISO timestamp", () => {
    const s = mcpStore.add(uid, base);
    expect(() => new Date(s.createdAt)).not.toThrow();
  });
});

describe("mcpStore.list", () => {
  it("returns only servers for the given user", () => {
    mcpStore.add(uid, base);
    mcpStore.add("other-user", { name: "other", url: "https://other.com" });
    expect(mcpStore.list(uid).length).toBe(1);
  });

  it("returns servers sorted by createdAt ascending", () => {
    const a = mcpStore.add(uid, { name: "A", url: "https://a.com" });
    const b = mcpStore.add(uid, { name: "B", url: "https://b.com" });
    const list = mcpStore.list(uid);
    expect(list[0].id).toBe(a.id);
    expect(list[1].id).toBe(b.id);
  });

  it("returns empty array when no servers", () => {
    expect(mcpStore.list(uid)).toEqual([]);
  });
});

describe("mcpStore.get", () => {
  it("returns the full server record (including authHeaderValue)", () => {
    const s = mcpStore.add(uid, {
      ...base,
      authHeaderKey: "Authorization",
      authHeaderValue: "secret",
    });
    const full = mcpStore.get(s.id);
    expect(full).toBeDefined();
    expect(full!.authHeaderValue).toBe("secret");
  });

  it("returns undefined for unknown id", () => {
    expect(mcpStore.get("nope")).toBeUndefined();
  });
});

describe("mcpStore.remove", () => {
  it("removes a server and returns true", () => {
    const s = mcpStore.add(uid, base);
    expect(mcpStore.remove(s.id, uid)).toBe(true);
    expect(mcpStore.list(uid).length).toBe(0);
  });

  it("returns false for unknown id", () => {
    expect(mcpStore.remove("no-such-id", uid)).toBe(false);
  });

  it("returns false when userId does not match", () => {
    const s = mcpStore.add(uid, base);
    expect(mcpStore.remove(s.id, "wrong-user")).toBe(false);
    expect(mcpStore.list(uid).length).toBe(1);
  });
});
