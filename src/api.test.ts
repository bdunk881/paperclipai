/**
 * API contract tests for AutoFlow Express endpoints.
 *
 * These tests verify the HTTP contract (status codes, response shapes, and
 * error handling) without requiring a live LLM or external service.
 */

// Prevent transitive import of ESM-only @mistralai/mistralai package
jest.mock("./engine/llmProviders", () => ({
  getProvider: jest.fn(),
}));
jest.mock("./auth/authMiddleware", () => ({
  requireAuth: (req: { headers: { authorization?: string }; auth?: { sub: string } }, res: { status: (code: number) => { json: (body: unknown) => void } }, next: () => void) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or malformed Authorization header." });
      return;
    }
    req.auth = { sub: auth.slice(7) };
    next();
  },
}));

// Bypass JWT verification in unit tests — inject a synthetic auth principal
jest.mock("./auth/authMiddleware", () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.auth = { sub: "test-user-id", email: "test@example.com" };
    next();
  },
}));

import request from "supertest";
import app from "./app";
import { WORKFLOW_TEMPLATES } from "./templates";
import {
  clearClassificationDecisionsForTests,
  logClassificationDecision,
} from "./engine/classificationLog";
import { extractPromptFeatures } from "./engine/promptFeatures";

function asAuth(userId = "test-user") {
  return { Authorization: `Bearer ${userId}` };
}

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("returns the correct template count", async () => {
    const res = await request(app).get("/health");
    expect(res.body.templates).toBe(WORKFLOW_TEMPLATES.length);
  });
});

// ---------------------------------------------------------------------------
// GET /api/templates
// ---------------------------------------------------------------------------

describe("GET /api/templates", () => {
  it("returns 200 with a templates array", async () => {
    const res = await request(app).get("/api/templates");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.templates)).toBe(true);
  });

  it("returns all 3 templates when no category filter is applied", async () => {
    const res = await request(app).get("/api/templates");
    expect(res.body.total).toBe(3);
    expect(res.body.templates).toHaveLength(3);
  });

  it("each template summary has required shape fields", async () => {
    const res = await request(app).get("/api/templates");
    for (const t of res.body.templates) {
      expect(typeof t.id).toBe("string");
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(typeof t.category).toBe("string");
      expect(typeof t.version).toBe("string");
      expect(typeof t.stepCount).toBe("number");
      expect(typeof t.configFieldCount).toBe("number");
      // Summary should NOT include the full steps / configFields arrays
      expect(t.steps).toBeUndefined();
      expect(t.configFields).toBeUndefined();
    }
  });

  it("filters by category=support", async () => {
    const res = await request(app).get("/api/templates?category=support");
    expect(res.status).toBe(200);
    expect(res.body.templates.every((t: { category: string }) => t.category === "support")).toBe(true);
    expect(res.body.total).toBe(res.body.templates.length);
  });

  it("filters by category=sales", async () => {
    const res = await request(app).get("/api/templates?category=sales");
    expect(res.status).toBe(200);
    expect(res.body.templates.every((t: { category: string }) => t.category === "sales")).toBe(true);
  });

  it("filters by category=content", async () => {
    const res = await request(app).get("/api/templates?category=content");
    expect(res.status).toBe(200);
    expect(res.body.templates.every((t: { category: string }) => t.category === "content")).toBe(true);
  });

  it("returns empty templates array for unknown category", async () => {
    const res = await request(app).get("/api/templates?category=unknown");
    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it("total matches templates array length", async () => {
    const res = await request(app).get("/api/templates");
    expect(res.body.total).toBe(res.body.templates.length);
  });
});

// ---------------------------------------------------------------------------
// GET /api/templates/:id
// ---------------------------------------------------------------------------

describe("GET /api/templates/:id", () => {
  it("returns 200 with full template for a known id", async () => {
    const res = await request(app).get("/api/templates/tpl-support-bot");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("tpl-support-bot");
  });

  it("returns full steps and configFields arrays", async () => {
    const res = await request(app).get("/api/templates/tpl-support-bot");
    expect(Array.isArray(res.body.steps)).toBe(true);
    expect(res.body.steps.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.configFields)).toBe(true);
    expect(res.body.configFields.length).toBeGreaterThan(0);
  });

  it("returns full template for lead enrichment", async () => {
    const res = await request(app).get("/api/templates/tpl-lead-enrich");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("tpl-lead-enrich");
    expect(res.body.category).toBe("sales");
  });

  it("returns full template for content generator", async () => {
    const res = await request(app).get("/api/templates/tpl-content-gen");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("tpl-content-gen");
    expect(res.body.category).toBe("content");
  });

  it("returns 404 with error message for unknown id", async () => {
    const res = await request(app).get("/api/templates/tpl-does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("each step in full template has required fields", async () => {
    const res = await request(app).get("/api/templates/tpl-support-bot");
    for (const step of res.body.steps) {
      expect(typeof step.id).toBe("string");
      expect(typeof step.name).toBe("string");
      expect(typeof step.kind).toBe("string");
      expect(typeof step.description).toBe("string");
      expect(Array.isArray(step.inputKeys)).toBe(true);
      expect(Array.isArray(step.outputKeys)).toBe(true);
    }
  });

  it("full template includes sampleInput and expectedOutput", async () => {
    const res = await request(app).get("/api/templates/tpl-support-bot");
    expect(res.body.sampleInput).toBeDefined();
    expect(typeof res.body.sampleInput).toBe("object");
    expect(res.body.expectedOutput).toBeDefined();
    expect(typeof res.body.expectedOutput).toBe("object");
  });
});

// ---------------------------------------------------------------------------
// GET /api/templates/:id/sample
// ---------------------------------------------------------------------------

describe("GET /api/templates/:id/sample", () => {
  it("returns 200 with sampleInput and expectedOutput", async () => {
    const res = await request(app).get("/api/templates/tpl-support-bot/sample");
    expect(res.status).toBe(200);
    expect(res.body.sampleInput).toBeDefined();
    expect(res.body.expectedOutput).toBeDefined();
  });

  it("sampleInput is a non-empty object", async () => {
    const res = await request(app).get("/api/templates/tpl-support-bot/sample");
    expect(Object.keys(res.body.sampleInput).length).toBeGreaterThan(0);
  });

  it("expectedOutput is a non-empty object", async () => {
    const res = await request(app).get("/api/templates/tpl-support-bot/sample");
    expect(Object.keys(res.body.expectedOutput).length).toBeGreaterThan(0);
  });

  it("sample endpoint works for all 3 templates", async () => {
    const ids = ["tpl-support-bot", "tpl-lead-enrich", "tpl-content-gen"];
    for (const id of ids) {
      const res = await request(app).get(`/api/templates/${id}/sample`);
      expect(res.status).toBe(200);
      expect(res.body.sampleInput).toBeDefined();
      expect(res.body.expectedOutput).toBeDefined();
    }
  });

  it("returns 404 for unknown template id", async () => {
    const res = await request(app).get("/api/templates/tpl-unknown/sample");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// POST /api/runs
// ---------------------------------------------------------------------------

describe("POST /api/runs", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const res = await request(app)
      .post("/api/runs")
      .send({ templateId: "tpl-support-bot", input: {} });
    expect(res.status).toBe(401);
  });

  it("returns 202 with a pending run for a valid templateId", async () => {
    const res = await request(app)
      .post("/api/runs")
      .set(asAuth())
      .send({ templateId: "tpl-support-bot", input: { ticketId: "TKT-001", subject: "Help", body: "I need help", customerEmail: "test@example.com", channel: "email" } });
    expect(res.status).toBe(202);
    expect(res.body.id).toBeDefined();
    expect(res.body.templateId).toBe("tpl-support-bot");
    expect(["pending", "running", "completed"]).toContain(res.body.status);
  });

  it("returns 400 when templateId is missing", async () => {
    const res = await request(app)
      .post("/api/runs")
      .set(asAuth())
      .send({ input: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/templateId/i);
  });

  it("returns 404 for an unknown templateId", async () => {
    const res = await request(app)
      .post("/api/runs")
      .set(asAuth())
      .send({ templateId: "tpl-nonexistent", input: {} });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns a run with startedAt timestamp", async () => {
    const res = await request(app)
      .post("/api/runs")
      .set(asAuth())
      .send({ templateId: "tpl-support-bot", input: {} });
    expect(res.status).toBe(202);
    expect(typeof res.body.startedAt).toBe("string");
    expect(new Date(res.body.startedAt).getTime()).not.toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// GET /api/runs
// ---------------------------------------------------------------------------

describe("GET /api/runs", () => {
  it("returns 200 with a runs array", async () => {
    const res = await request(app).get("/api/runs").set(asAuth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.runs)).toBe(true);
    expect(typeof res.body.total).toBe("number");
  });

  it("total matches runs array length", async () => {
    const res = await request(app).get("/api/runs").set(asAuth());
    expect(res.body.total).toBe(res.body.runs.length);
  });
});

// ---------------------------------------------------------------------------
// GET /api/runs/:id
// ---------------------------------------------------------------------------

describe("GET /api/runs/:id", () => {
  it("returns 202 run and then retrieves it by id", async () => {
    const startRes = await request(app)
      .post("/api/runs")
      .set(asAuth())
      .send({ templateId: "tpl-support-bot", input: { ticketId: "TKT-002", subject: "Issue", body: "Problem", customerEmail: "b@example.com", channel: "email" } });
    expect(startRes.status).toBe(202);
    const runId = startRes.body.id;

    const getRes = await request(app).get(`/api/runs/${runId}`).set(asAuth());
    expect(getRes.status).toBe(200);
    expect(getRes.body.id).toBe(runId);
  });

  it("returns 404 for an unknown run id", async () => {
    const res = await request(app).get("/api/runs/run-does-not-exist").set(asAuth());
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// GET /api/analytics/routing-decisions
// ---------------------------------------------------------------------------

describe("GET /api/analytics/routing-decisions", () => {
  beforeEach(() => {
    clearClassificationDecisionsForTests();
  });

  afterEach(() => {
    clearClassificationDecisionsForTests();
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/analytics/routing-decisions");
    expect(res.status).toBe(401);
  });

  it("returns logged routing decisions for dashboard consumption", async () => {
    logClassificationDecision({
      promptHash: "hash-1",
      features: extractPromptFeatures("Classify this ticket", 120, 1),
      selectedTier: "lite",
      confidenceScore: 0.9,
      modelId: "gpt-4o-mini",
    });

    const res = await request(app)
      .get("/api/analytics/routing-decisions")
      .set(asAuth());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.decisions)).toBe(true);
    expect(res.body.total).toBe(1);
    expect(typeof res.body.capacity).toBe("number");
    expect(res.body.decisions[0]).toEqual(
      expect.objectContaining({
        promptHash: "hash-1",
        selectedTier: "lite",
        confidenceScore: 0.9,
        modelId: "gpt-4o-mini",
      })
    );
    expect(res.body.decisions[0].features).toBeDefined();
    expect(typeof res.body.decisions[0].timestamp).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// POST /api/webhooks/:templateId
// ---------------------------------------------------------------------------

describe("POST /api/webhooks/:templateId", () => {
  it("returns 202 with runId and status for a valid templateId", async () => {
    const res = await request(app)
      .post("/api/webhooks/tpl-support-bot")
      .send({ ticketId: "WH-001", subject: "Webhook test", body: "Hello", customerEmail: "wh@example.com", channel: "webhook" });
    expect(res.status).toBe(202);
    expect(typeof res.body.runId).toBe("string");
    expect(["pending", "running", "completed"]).toContain(res.body.status);
  });

  it("returns 404 for an unknown templateId", async () => {
    const res = await request(app)
      .post("/api/webhooks/tpl-nonexistent")
      .send({ data: "test" });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 400 when body is not a JSON object", async () => {
    const res = await request(app)
      .post("/api/webhooks/tpl-support-bot")
      .set("Content-Type", "application/json")
      .send("not-an-object");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JSON object/i);
  });

  it("returns 400 when body is an array", async () => {
    const res = await request(app)
      .post("/api/webhooks/tpl-support-bot")
      .send([{ ticketId: "T-1" }]);
    expect(res.status).toBe(400);
  });

  it("webhook response only contains runId and status (not full run object)", async () => {
    const res = await request(app)
      .post("/api/webhooks/tpl-support-bot")
      .send({ ticketId: "WH-002" });
    expect(res.status).toBe(202);
    expect(res.body.runId).toBeDefined();
    expect(res.body.status).toBeDefined();
    // Should NOT return the full run body
    expect(res.body.templateId).toBeUndefined();
    expect(res.body.stepResults).toBeUndefined();
  });

  it("run created by webhook is retrievable via GET /api/runs/:id", async () => {
    const webhookRes = await request(app)
      .post("/api/webhooks/tpl-support-bot")
      .send({ ticketId: "WH-003", subject: "Test" });
    expect(webhookRes.status).toBe(202);

    const runId = webhookRes.body.runId;
    const getRes = await request(app).get(`/api/runs/${runId}`).set(asAuth());
    expect(getRes.status).toBe(200);
    expect(getRes.body.id).toBe(runId);
  });

  it("all 3 template webhooks accept valid input", async () => {
    const cases = [
      { id: "tpl-support-bot", body: { ticketId: "T1" } },
      { id: "tpl-lead-enrich", body: { leadId: "L1", email: "lead@test.com" } },
      { id: "tpl-content-gen", body: { topic: "AI", keywords: [], audience: "all", format: "blog", wordCount: 500 } },
    ];
    for (const { id, body } of cases) {
      const res = await request(app).post(`/api/webhooks/${id}`).send(body);
      expect(res.status).toBe(202);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /health — enhanced (now returns run stats)
// ---------------------------------------------------------------------------

describe("GET /health — run stats", () => {
  it("returns runs object with total, running, completed, failed counts", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.runs).toBeDefined();
    expect(typeof res.body.runs.total).toBe("number");
    expect(typeof res.body.runs.running).toBe("number");
    expect(typeof res.body.runs.completed).toBe("number");
    expect(typeof res.body.runs.failed).toBe("number");
  });

  it("run counts are non-negative integers", async () => {
    const res = await request(app).get("/health");
    const { total, running, completed, failed } = res.body.runs;
    expect(total).toBeGreaterThanOrEqual(0);
    expect(running).toBeGreaterThanOrEqual(0);
    expect(completed).toBeGreaterThanOrEqual(0);
    expect(failed).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

describe("Rate limiting", () => {
  it("enforces LLM endpoint limits per authenticated user and returns Retry-After", async () => {
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app)
        .post("/api/runs")
        .set(asAuth("rate-limit-llm-user"))
        .send({ templateId: "tpl-support-bot", input: { ticketId: `RL-${i}` } });
      expect(res.status).toBe(202);
    }

    const blocked = await request(app)
      .post("/api/runs")
      .set(asAuth("rate-limit-llm-user"))
      .send({ templateId: "tpl-support-bot", input: { ticketId: "RL-over" } });

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("enforces general API limits and returns Retry-After", async () => {
    for (let i = 0; i < 100; i += 1) {
      const res = await request(app).get("/api/templates").set("X-User-Id", "rate-limit-general-user");
      expect(res.status).toBe(200);
    }

    const blocked = await request(app).get("/api/templates").set("X-User-Id", "rate-limit-general-user");
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Content-type and error handling
// ---------------------------------------------------------------------------

describe("Content-Type and error handling", () => {
  it("all successful responses use application/json", async () => {
    const endpoints = [
      "/health",
      "/api/templates",
      "/api/templates/tpl-support-bot",
      "/api/templates/tpl-support-bot/sample",
      "/api/runs",
    ];
    for (const ep of endpoints) {
      const res = await request(app).get(ep);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
    }
  });

  it("404 responses use application/json", async () => {
    const res = await request(app).get("/api/templates/tpl-nope");
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});
