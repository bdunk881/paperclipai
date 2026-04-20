/**
 * API contract tests for MCP server registry routes.
 * Uses supertest against the full Express app.
 * fetch() calls to external MCP servers are mocked.
 */

jest.mock("../engine/llmProviders", () => ({ getProvider: jest.fn() }));

import request from "supertest";
import app from "../app";
import { mcpStore } from "./mcpStore";

const USER = "user-test-mcp";
const H = { "X-User-Id": USER };

beforeEach(() => {
  mcpStore._clear();
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// GET /api/mcp/servers
// ---------------------------------------------------------------------------

describe("GET /api/mcp/servers", () => {
  it("returns 401 without X-User-Id header", async () => {
    const res = await request(app).get("/api/mcp/servers");
    expect(res.status).toBe(401);
  });

  it("returns empty list when no servers registered", async () => {
    const res = await request(app).get("/api/mcp/servers").set(H);
    expect(res.status).toBe(200);
    expect(res.body.servers).toEqual([]);
  });

  it("returns only servers for the requesting user", async () => {
    mcpStore.add(USER, { name: "My Server", url: "https://mcp.example.com" });
    mcpStore.add("other-user", { name: "Other", url: "https://other.com" });
    const res = await request(app).get("/api/mcp/servers").set(H);
    expect(res.body.servers).toHaveLength(1);
    expect(res.body.servers[0].name).toBe("My Server");
  });
});

// ---------------------------------------------------------------------------
// POST /api/mcp/servers
// ---------------------------------------------------------------------------

describe("POST /api/mcp/servers", () => {
  it("returns 401 without X-User-Id header", async () => {
    const res = await request(app).post("/api/mcp/servers").send({ name: "x", url: "https://x.com" });
    expect(res.status).toBe(401);
  });

  it("creates a server and returns 201", async () => {
    const res = await request(app)
      .post("/api/mcp/servers")
      .set(H)
      .send({ name: "Test MCP", url: "https://mcp.test.com" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Test MCP");
    expect(res.body.url).toBe("https://mcp.test.com");
    expect(res.body.hasAuth).toBe(false);
  });

  it("returns 400 when name is missing", async () => {
    const res = await request(app)
      .post("/api/mcp/servers")
      .set(H)
      .send({ url: "https://mcp.test.com" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/);
  });

  it("returns 400 when url is missing", async () => {
    const res = await request(app)
      .post("/api/mcp/servers")
      .set(H)
      .send({ name: "Test" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/url/);
  });

  it("sets hasAuth=true when auth fields provided", async () => {
    const res = await request(app)
      .post("/api/mcp/servers")
      .set(H)
      .send({ name: "Secure", url: "https://secure.com", authHeaderKey: "Authorization", authHeaderValue: "Bearer tok" });
    expect(res.status).toBe(201);
    expect(res.body.hasAuth).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/mcp/servers/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/mcp/servers/:id", () => {
  it("returns 401 without X-User-Id header", async () => {
    const s = mcpStore.add(USER, { name: "x", url: "https://x.com" });
    const res = await request(app).delete(`/api/mcp/servers/${s.id}`);
    expect(res.status).toBe(401);
  });

  it("deletes and returns 204", async () => {
    const s = mcpStore.add(USER, { name: "del me", url: "https://del.com" });
    const res = await request(app).delete(`/api/mcp/servers/${s.id}`).set(H);
    expect(res.status).toBe(204);
    expect(mcpStore.list(USER)).toHaveLength(0);
  });

  it("returns 404 for unknown server", async () => {
    const res = await request(app).delete("/api/mcp/servers/no-such-id").set(H);
    expect(res.status).toBe(404);
  });

  it("returns 404 when server belongs to another user", async () => {
    const s = mcpStore.add("other-user", { name: "x", url: "https://x.com" });
    const res = await request(app).delete(`/api/mcp/servers/${s.id}`).set(H);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/mcp/servers/:id/tools
// ---------------------------------------------------------------------------

describe("GET /api/mcp/servers/:id/tools", () => {
  it("returns 401 without X-User-Id header", async () => {
    const s = mcpStore.add(USER, { name: "x", url: "https://x.com" });
    const res = await request(app).get(`/api/mcp/servers/${s.id}/tools`);
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown server", async () => {
    const res = await request(app).get("/api/mcp/servers/no-such/tools").set(H);
    expect(res.status).toBe(404);
  });

  it("returns tools list on successful MCP response", async () => {
    const s = mcpStore.add(USER, { name: "My MCP", url: "https://mcp.example.com" });
    const mockFetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "search", description: "Search tool" }] } }),
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const res = await request(app).get(`/api/mcp/servers/${s.id}/tools`).set(H);
    expect(res.status).toBe(200);
    expect(res.body.tools).toHaveLength(1);
    expect(res.body.tools[0].name).toBe("search");
    expect(res.body.serverName).toBe("My MCP");
  });

  it("returns 502 when MCP server is unreachable", async () => {
    const s = mcpStore.add(USER, { name: "x", url: "https://mcp.example.com" });
    global.fetch = jest.fn().mockRejectedValueOnce(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    const res = await request(app).get(`/api/mcp/servers/${s.id}/tools`).set(H);
    expect(res.status).toBe(502);
    expect(res.body.error).toContain("Could not reach MCP server");
  });

  it("returns 502 when MCP server returns HTTP error", async () => {
    const s = mcpStore.add(USER, { name: "x", url: "https://mcp.example.com" });
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 503, statusText: "Service Unavailable", json: async () => ({}) }) as unknown as typeof fetch;

    const res = await request(app).get(`/api/mcp/servers/${s.id}/tools`).set(H);
    expect(res.status).toBe(502);
  });

  it("returns 502 when MCP server returns JSON-RPC error", async () => {
    const s = mcpStore.add(USER, { name: "x", url: "https://mcp.example.com" });
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } }),
    }) as unknown as typeof fetch;

    const res = await request(app).get(`/api/mcp/servers/${s.id}/tools`).set(H);
    expect(res.status).toBe(502);
  });

  it("includes auth header when server has auth credentials", async () => {
    const s = mcpStore.add(USER, { name: "Secure", url: "https://mcp.example.com", authHeaderKey: "Authorization", authHeaderValue: "Bearer secret" });
    let capturedHeaders: Record<string, string> = {};
    global.fetch = jest.fn().mockImplementationOnce(async (_url: unknown, opts: { headers: Record<string, string> }) => {
      capturedHeaders = opts.headers;
      return {
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: { tools: [] } }),
      };
    }) as unknown as typeof fetch;

    await request(app).get(`/api/mcp/servers/${s.id}/tools`).set(H);
    expect(capturedHeaders["Authorization"]).toBe("Bearer secret");
  });
});

// ---------------------------------------------------------------------------
// POST /api/mcp/servers/:id/test
// ---------------------------------------------------------------------------

describe("POST /api/mcp/servers/:id/test", () => {
  it("returns 401 without X-User-Id header", async () => {
    const s = mcpStore.add(USER, { name: "x", url: "https://x.com" });
    const res = await request(app).post(`/api/mcp/servers/${s.id}/test`);
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown server", async () => {
    const res = await request(app).post("/api/mcp/servers/no-such/test").set(H);
    expect(res.status).toBe(404);
  });

  it("returns ok=true on successful connection", async () => {
    const s = mcpStore.add(USER, { name: "x", url: "https://mcp.example.com" });
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: { tools: [] } }),
    }) as unknown as typeof fetch;

    const res = await request(app).post(`/api/mcp/servers/${s.id}/test`).set(H);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns 502 and ok=false on connection failure", async () => {
    const s = mcpStore.add(USER, { name: "x", url: "https://mcp.example.com" });
    global.fetch = jest.fn().mockRejectedValueOnce(new Error("timeout")) as unknown as typeof fetch;

    const res = await request(app).post(`/api/mcp/servers/${s.id}/test`).set(H);
    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
  });
});
