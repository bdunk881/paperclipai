/**
 * API contract tests for Memory routes.
 * Uses supertest against the full Express app.
 */

jest.mock("../engine/llmProviders", () => ({ getProvider: jest.fn() }));

// Bridge legacy X-User-Id header into req.auth.sub so tests work after JWT auth hardening.
// Returns 401 when no X-User-Id is present, mirroring the real requireAuth 401 behaviour.
jest.mock("../auth/authMiddleware", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requireAuth: (req: Record<string, unknown>, res: any, next: () => void) => {
    const headers = req.headers as Record<string, string>;
    const sub = headers["x-user-id"];
    if (!sub) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.auth = { sub };
    next();
  },
}));

import request from "supertest";
import app from "../app";
import { memoryStore } from "../engine/memoryStore";

const USER = "user-mem-test";
const H = { "X-User-Id": USER };

beforeEach(() => {
  memoryStore.clear();
});

// ---------------------------------------------------------------------------
// POST /api/memory
// ---------------------------------------------------------------------------

describe("POST /api/memory", () => {
  it("returns 401 without X-User-Id", async () => {
    const res = await request(app).post("/api/memory").send({ key: "k", text: "v" });
    expect(res.status).toBe(401);
  });

  it("creates an entry and returns 201", async () => {
    const res = await request(app)
      .post("/api/memory")
      .set(H)
      .send({ key: "pref", text: "dark mode" });
    expect(res.status).toBe(201);
    expect(res.body.key).toBe("pref");
    expect(res.body.text).toBe("dark mode");
    expect(res.body.userId).toBe(USER);
    expect(res.body.id).toBeDefined();
  });

  it("returns 400 when key is missing", async () => {
    const res = await request(app).post("/api/memory").set(H).send({ text: "v" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/key/);
  });

  it("returns 400 when key is empty string", async () => {
    const res = await request(app).post("/api/memory").set(H).send({ key: "  ", text: "v" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when text is missing", async () => {
    const res = await request(app).post("/api/memory").set(H).send({ key: "k" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/text/);
  });

  it("returns 400 when ttlSeconds is zero", async () => {
    const res = await request(app).post("/api/memory").set(H).send({ key: "k", text: "v", ttlSeconds: 0 });
    expect(res.status).toBe(400);
  });

  it("returns 400 when ttlSeconds is negative", async () => {
    const res = await request(app).post("/api/memory").set(H).send({ key: "k", text: "v", ttlSeconds: -1 });
    expect(res.status).toBe(400);
  });

  it("accepts optional workflowId, agentId, ttlSeconds", async () => {
    const res = await request(app)
      .post("/api/memory")
      .set(H)
      .send({ key: "ctx", text: "value", workflowId: "wf-1", agentId: "agent-1", ttlSeconds: 3600 });
    expect(res.status).toBe(201);
    expect(res.body.workflowId).toBe("wf-1");
    expect(res.body.agentId).toBe("agent-1");
    expect(res.body.expiresAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// GET /api/memory
// ---------------------------------------------------------------------------

describe("GET /api/memory", () => {
  it("returns 401 without X-User-Id", async () => {
    const res = await request(app).get("/api/memory");
    expect(res.status).toBe(401);
  });

  it("returns empty list when no entries", async () => {
    const res = await request(app).get("/api/memory").set(H);
    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("returns only the user's entries", async () => {
    memoryStore.write({ userId: USER, key: "a", text: "mine" });
    memoryStore.write({ userId: "other", key: "b", text: "theirs" });
    const res = await request(app).get("/api/memory").set(H);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].userId).toBe(USER);
  });

  it("filters by workflowId when provided", async () => {
    memoryStore.write({ userId: USER, key: "a", text: "wf1", workflowId: "wf-1" });
    memoryStore.write({ userId: USER, key: "b", text: "wf2", workflowId: "wf-2" });
    const res = await request(app).get("/api/memory?workflowId=wf-1").set(H);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].workflowId).toBe("wf-1");
  });
});

// ---------------------------------------------------------------------------
// GET /api/memory/search
// ---------------------------------------------------------------------------

describe("GET /api/memory/search", () => {
  it("returns 401 without X-User-Id", async () => {
    const res = await request(app).get("/api/memory/search?q=test");
    expect(res.status).toBe(401);
  });

  it("returns matching results", async () => {
    memoryStore.write({ userId: USER, key: "color", text: "user likes blue" });
    memoryStore.write({ userId: USER, key: "food", text: "user likes pizza" });
    const res = await request(app).get("/api/memory/search?q=blue").set(H);
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThan(0);
    expect(res.body.total).toBeDefined();
  });

  it("returns all entries with empty query", async () => {
    memoryStore.write({ userId: USER, key: "a", text: "anything" });
    const res = await request(app).get("/api/memory/search?q=").set(H);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
  });

  it("filters by agentId", async () => {
    memoryStore.write({ userId: USER, key: "ctx", text: "agent data", agentId: "agent-1" });
    memoryStore.write({ userId: USER, key: "other", text: "other data" });
    const res = await request(app).get("/api/memory/search?q=&agentId=agent-1").set(H);
    expect(res.body.results).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// GET /api/memory/stats
// ---------------------------------------------------------------------------

describe("GET /api/memory/stats", () => {
  it("returns 401 without X-User-Id", async () => {
    const res = await request(app).get("/api/memory/stats");
    expect(res.status).toBe(401);
  });

  it("returns zero counts for user with no entries", async () => {
    const res = await request(app).get("/api/memory/stats").set(H);
    expect(res.status).toBe(200);
    expect(res.body.totalEntries).toBe(0);
  });

  it("returns correct counts after writing entries", async () => {
    memoryStore.write({ userId: USER, key: "a", text: "hello", workflowId: "wf-1" });
    memoryStore.write({ userId: USER, key: "b", text: "world", workflowId: "wf-2" });
    const res = await request(app).get("/api/memory/stats").set(H);
    expect(res.body.totalEntries).toBe(2);
    expect(res.body.workflowCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/memory/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/memory/:id", () => {
  it("returns 401 without X-User-Id", async () => {
    const e = memoryStore.write({ userId: USER, key: "x", text: "y" });
    const res = await request(app).delete(`/api/memory/${e.id}`);
    expect(res.status).toBe(401);
  });

  it("deletes and returns 204", async () => {
    const e = memoryStore.write({ userId: USER, key: "del", text: "me" });
    const res = await request(app).delete(`/api/memory/${e.id}`).set(H);
    expect(res.status).toBe(204);
    expect(memoryStore.get(e.id)).toBeUndefined();
  });

  it("returns 404 for unknown id", async () => {
    const res = await request(app).delete("/api/memory/no-such-id").set(H);
    expect(res.status).toBe(404);
  });

  it("returns 404 when entry belongs to another user", async () => {
    const e = memoryStore.write({ userId: "other-user", key: "x", text: "y" });
    const res = await request(app).delete(`/api/memory/${e.id}`).set(H);
    expect(res.status).toBe(404);
  });
});
