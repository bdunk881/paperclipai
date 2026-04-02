/**
 * Integration tests for /api/llm-configs endpoints.
 * Covers full lifecycle: create, list, update, set-default, delete.
 * Verifies that raw API keys are never present in any response.
 */

// Prevent transitive import of ESM-only @mistralai/mistralai package
jest.mock("../engine/llmProviders", () => ({
  getProvider: jest.fn(),
}));

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
import { llmConfigStore } from "./llmConfigStore";

const USER_A = "user-alice";
const USER_B = "user-bob";

function asUser(userId: string) {
  return { "x-user-id": userId };
}

beforeEach(() => {
  llmConfigStore.clear();
});

// ---------------------------------------------------------------------------
// POST /api/llm-configs
// ---------------------------------------------------------------------------

describe("POST /api/llm-configs", () => {
  it("creates a config and returns 201 with masked key", async () => {
    const res = await request(app)
      .post("/api/llm-configs")
      .set(asUser(USER_A))
      .send({
        provider: "openai",
        label: "My GPT-4o key",
        model: "gpt-4o",
        apiKey: "sk-test-abc1234",
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.provider).toBe("openai");
    expect(res.body.label).toBe("My GPT-4o key");
    expect(res.body.model).toBe("gpt-4o");
    expect(res.body.apiKeyMasked).toBe("****1234");
    expect(res.body.isDefault).toBe(false);
    expect(res.body.userId).toBe(USER_A);
    expect(typeof res.body.createdAt).toBe("string");
  });

  it("never returns the raw apiKey or apiKeyEncrypted", async () => {
    const res = await request(app)
      .post("/api/llm-configs")
      .set(asUser(USER_A))
      .send({
        provider: "anthropic",
        label: "Claude key",
        model: "claude-3-5-sonnet-20241022",
        apiKey: "sk-ant-supersecret",
      });

    expect(res.status).toBe(201);
    expect(res.body.apiKey).toBeUndefined();
    expect(res.body.apiKeyEncrypted).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("supersecret");
  });

  it("returns 401 when X-User-Id header is missing", async () => {
    const res = await request(app)
      .post("/api/llm-configs")
      .send({ provider: "openai", label: "key", model: "gpt-4o", apiKey: "sk-test-1234" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  it("returns 400 for an invalid provider", async () => {
    const res = await request(app)
      .post("/api/llm-configs")
      .set(asUser(USER_A))
      .send({ provider: "llama", label: "key", model: "llama-3", apiKey: "sk-test-1234" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/provider/i);
  });

  it("returns 400 when label is missing", async () => {
    const res = await request(app)
      .post("/api/llm-configs")
      .set(asUser(USER_A))
      .send({ provider: "openai", model: "gpt-4o", apiKey: "sk-test-1234" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/label/i);
  });

  it("returns 400 when model is missing", async () => {
    const res = await request(app)
      .post("/api/llm-configs")
      .set(asUser(USER_A))
      .send({ provider: "openai", label: "My key", apiKey: "sk-test-1234" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/model/i);
  });

  it("returns 400 when apiKey is too short", async () => {
    const res = await request(app)
      .post("/api/llm-configs")
      .set(asUser(USER_A))
      .send({ provider: "openai", label: "My key", model: "gpt-4o", apiKey: "ab" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/apiKey/i);
  });

  it("accepts all valid providers", async () => {
    const providers = ["openai", "anthropic", "gemini", "mistral"];
    for (const provider of providers) {
      const res = await request(app)
        .post("/api/llm-configs")
        .set(asUser(USER_A))
        .send({ provider, label: `${provider} key`, model: "model-x", apiKey: "sk-test-1234" });
      expect(res.status).toBe(201);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/llm-configs
// ---------------------------------------------------------------------------

describe("GET /api/llm-configs", () => {
  it("returns 200 with an empty list when no configs exist", async () => {
    const res = await request(app)
      .get("/api/llm-configs")
      .set(asUser(USER_A));

    expect(res.status).toBe(200);
    expect(res.body.configs).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("returns only the requesting user's configs", async () => {
    // Create one config for USER_A and one for USER_B
    await request(app)
      .post("/api/llm-configs")
      .set(asUser(USER_A))
      .send({ provider: "openai", label: "Alice key", model: "gpt-4o", apiKey: "sk-test-alice1" });

    await request(app)
      .post("/api/llm-configs")
      .set(asUser(USER_B))
      .send({ provider: "anthropic", label: "Bob key", model: "claude-3-haiku", apiKey: "sk-test-bob12" });

    const resA = await request(app).get("/api/llm-configs").set(asUser(USER_A));
    expect(resA.status).toBe(200);
    expect(resA.body.configs).toHaveLength(1);
    expect(resA.body.configs[0].userId).toBe(USER_A);
    expect(resA.body.total).toBe(1);

    const resB = await request(app).get("/api/llm-configs").set(asUser(USER_B));
    expect(resB.status).toBe(200);
    expect(resB.body.configs).toHaveLength(1);
    expect(resB.body.configs[0].userId).toBe(USER_B);
  });

  it("never returns apiKey or apiKeyEncrypted in list", async () => {
    await request(app)
      .post("/api/llm-configs")
      .set(asUser(USER_A))
      .send({ provider: "openai", label: "key", model: "gpt-4o", apiKey: "sk-test-listtest" });

    const res = await request(app).get("/api/llm-configs").set(asUser(USER_A));
    expect(res.status).toBe(200);
    for (const cfg of res.body.configs) {
      expect(cfg.apiKey).toBeUndefined();
      expect(cfg.apiKeyEncrypted).toBeUndefined();
    }
    expect(JSON.stringify(res.body)).not.toContain("listtest");
  });

  it("returns 401 when X-User-Id header is missing", async () => {
    const res = await request(app).get("/api/llm-configs");
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/llm-configs/:id
// ---------------------------------------------------------------------------

describe("PATCH /api/llm-configs/:id", () => {
  it("updates label and model", async () => {
    const create = await request(app)
      .post("/api/llm-configs")
      .set(asUser(USER_A))
      .send({ provider: "openai", label: "Old label", model: "gpt-4", apiKey: "sk-test-patchtest" });

    const id = create.body.id;

    const res = await request(app)
      .patch(`/api/llm-configs/${id}`)
      .set(asUser(USER_A))
      .send({ label: "New label", model: "gpt-4o" });

    expect(res.status).toBe(200);
    expect(res.body.label).toBe("New label");
    expect(res.body.model).toBe("gpt-4o");
    expect(res.body.apiKeyEncrypted).toBeUndefined();
  });

  it("returns 404 for unknown id", async () => {
    const res = await request(app)
      .patch("/api/llm-configs/nonexistent-id")
      .set(asUser(USER_A))
      .send({ label: "x" });

    expect(res.status).toBe(404);
  });

  it("returns 404 when accessing another user's config", async () => {
    const create = await request(app)
      .post("/api/llm-configs")
      .set(asUser(USER_A))
      .send({ provider: "openai", label: "Alice key", model: "gpt-4o", apiKey: "sk-test-aaaaaaaa" });

    const id = create.body.id;

    const res = await request(app)
      .patch(`/api/llm-configs/${id}`)
      .set(asUser(USER_B))
      .send({ label: "Stolen" });

    expect(res.status).toBe(404);
  });

  it("returns 401 when X-User-Id header is missing", async () => {
    const res = await request(app)
      .patch("/api/llm-configs/some-id")
      .send({ label: "x" });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/llm-configs/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/llm-configs/:id", () => {
  it("deletes a config and returns 204", async () => {
    const create = await request(app)
      .post("/api/llm-configs")
      .set(asUser(USER_A))
      .send({ provider: "openai", label: "To delete", model: "gpt-4o", apiKey: "sk-test-todelete" });

    const id = create.body.id;

    const del = await request(app)
      .delete(`/api/llm-configs/${id}`)
      .set(asUser(USER_A));

    expect(del.status).toBe(204);

    // Verify it's gone from the list
    const list = await request(app).get("/api/llm-configs").set(asUser(USER_A));
    expect(list.body.configs).toHaveLength(0);
  });

  it("returns 404 for unknown id", async () => {
    const res = await request(app)
      .delete("/api/llm-configs/nonexistent-id")
      .set(asUser(USER_A));

    expect(res.status).toBe(404);
  });

  it("cannot delete another user's config", async () => {
    const create = await request(app)
      .post("/api/llm-configs")
      .set(asUser(USER_A))
      .send({ provider: "openai", label: "Alice key", model: "gpt-4o", apiKey: "sk-test-aaaaaaaa" });

    const id = create.body.id;

    const res = await request(app)
      .delete(`/api/llm-configs/${id}`)
      .set(asUser(USER_B));

    expect(res.status).toBe(404);

    // Alice's config should still exist
    const list = await request(app).get("/api/llm-configs").set(asUser(USER_A));
    expect(list.body.configs).toHaveLength(1);
  });

  it("returns 401 when X-User-Id header is missing", async () => {
    const res = await request(app).delete("/api/llm-configs/some-id");
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/llm-configs/:id/default
// ---------------------------------------------------------------------------

describe("PATCH /api/llm-configs/:id/default", () => {
  it("sets a config as default and returns updated config", async () => {
    const create = await request(app)
      .post("/api/llm-configs")
      .set(asUser(USER_A))
      .send({ provider: "openai", label: "Main key", model: "gpt-4o", apiKey: "sk-test-defaultt" });

    const id = create.body.id;

    const res = await request(app)
      .patch(`/api/llm-configs/${id}/default`)
      .set(asUser(USER_A));

    expect(res.status).toBe(200);
    expect(res.body.isDefault).toBe(true);
    expect(res.body.id).toBe(id);
  });

  it("clears the previous default when a new one is set", async () => {
    const first = await request(app)
      .post("/api/llm-configs")
      .set(asUser(USER_A))
      .send({ provider: "openai", label: "First", model: "gpt-4o", apiKey: "sk-test-first123" });

    const second = await request(app)
      .post("/api/llm-configs")
      .set(asUser(USER_A))
      .send({ provider: "anthropic", label: "Second", model: "claude-3-5-sonnet-20241022", apiKey: "sk-test-second12" });

    await request(app)
      .patch(`/api/llm-configs/${first.body.id}/default`)
      .set(asUser(USER_A));

    await request(app)
      .patch(`/api/llm-configs/${second.body.id}/default`)
      .set(asUser(USER_A));

    const list = await request(app).get("/api/llm-configs").set(asUser(USER_A));
    const configs = list.body.configs as Array<{ id: string; isDefault: boolean }>;

    const firstCfg = configs.find((c) => c.id === first.body.id);
    const secondCfg = configs.find((c) => c.id === second.body.id);

    expect(firstCfg?.isDefault).toBe(false);
    expect(secondCfg?.isDefault).toBe(true);
  });

  it("returns 404 for unknown id", async () => {
    const res = await request(app)
      .patch("/api/llm-configs/nonexistent/default")
      .set(asUser(USER_A));

    expect(res.status).toBe(404);
  });

  it("cannot set another user's config as default", async () => {
    const create = await request(app)
      .post("/api/llm-configs")
      .set(asUser(USER_A))
      .send({ provider: "openai", label: "Alice key", model: "gpt-4o", apiKey: "sk-test-aaaaaaaa" });

    const res = await request(app)
      .patch(`/api/llm-configs/${create.body.id}/default`)
      .set(asUser(USER_B));

    expect(res.status).toBe(404);
  });

  it("returns 401 when X-User-Id header is missing", async () => {
    const res = await request(app).patch("/api/llm-configs/some-id/default");
    expect(res.status).toBe(401);
  });
});
