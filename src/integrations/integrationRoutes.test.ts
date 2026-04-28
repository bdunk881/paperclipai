/**
 * Integration Framework API routes — test suite.
 *
 * Tests cover:
 *   - Catalog: list, get by slug, unknown slug
 *   - Connections: create, list, get, update, delete, set-default
 *   - Webhook relay: ingest + match, ingest + no match, inactive subscription
 *   - Trigger subscriptions: create, list, delete, list events
 */

// Mock the LLM providers to avoid ESM incompatibilities in Jest
jest.mock("../engine/llmProviders", () => ({ getProvider: jest.fn() }));

// Bypass JWT verification in unit tests.
// - Requests with an Authorization header get req.auth populated.
//   The X-User-Id header is reused as the test-user discriminator so that
//   per-user isolation tests (create-as-A, read-as-B → 404) still work.
// - Requests without an Authorization header get a 401, preserving coverage
//   of the "unauthenticated → rejected" contract without needing real JWTs.
jest.mock("../auth/authMiddleware", () => ({
  requireAuth: (
    req: Record<string, unknown>,
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    const headers = (req as { headers: Record<string, string | string[] | undefined> }).headers;
    if (!headers["authorization"]) {
      res.status(401).json({ error: "Missing or malformed Authorization header." });
      return;
    }
    const h = headers["x-user-id"];
    const sub = typeof h === "string" && h.trim() ? h.trim() : "test-user-id";
    req.auth = { sub, email: "test@example.com", roles: ["Operator"] };
    next();
  },
  requireAuthOrQaBypass: (
    req: Record<string, unknown>,
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    const headers = (req as { headers: Record<string, string | string[] | undefined> }).headers;
    if (!headers["authorization"]) {
      res.status(401).json({ error: "Missing or malformed Authorization header." });
      return;
    }
    const h = headers["x-user-id"];
    const sub = typeof h === "string" && h.trim() ? h.trim() : "test-user-id";
    req.auth = { sub, email: "test@example.com", roles: ["Operator"] };
    next();
  },
  requireRole: (..._roles: string[]) => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import request from "supertest";
import app from "../app";
import { integrationCredentialStore } from "./integrationCredentialStore";
import { webhookRelay } from "./webhookRelay";

const USER_ID = "test-user-123";
// Sent with every authenticated request in tests
const AUTH = { Authorization: "Bearer test-token" };

beforeEach(() => {
  integrationCredentialStore.clear();
  webhookRelay.clear();
});

// ---------------------------------------------------------------------------
// Catalog — public, no auth required
// ---------------------------------------------------------------------------

describe("GET /api/integrations/catalog", () => {
  it("returns a list of integrations with total", async () => {
    const res = await request(app).get("/api/integrations/catalog");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.catalog)).toBe(true);
    expect(res.body.total).toBeGreaterThanOrEqual(25);
    expect(res.body.categories).toBeDefined();
  });

  it("filters by category", async () => {
    const res = await request(app).get("/api/integrations/catalog?category=crm");
    expect(res.status).toBe(200);
    expect(res.body.catalog.every((i: { category: string }) => i.category === "crm")).toBe(true);
  });

  it("returns empty for unknown category", async () => {
    const res = await request(app).get("/api/integrations/catalog?category=not-a-category");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });
});

describe("GET /api/integrations/catalog/:slug", () => {
  it("returns a manifest for a known slug", async () => {
    const res = await request(app).get("/api/integrations/catalog/stripe");
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("stripe");
    expect(res.body.actions.length).toBeGreaterThan(0);
  });

  it("returns 404 for unknown slug", async () => {
    const res = await request(app).get("/api/integrations/catalog/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

describe("GET /api/integrations/connections", () => {
  it("returns 401 without Authorization header", async () => {
    const res = await request(app).get("/api/integrations/connections");
    expect(res.status).toBe(401);
  });

  it("returns empty list when no connections exist", async () => {
    const res = await request(app)
      .get("/api/integrations/connections")
      .set(AUTH)
      .set("X-User-Id", USER_ID);
    expect(res.status).toBe(200);
    expect(res.body.connections).toEqual([]);
  });
});

describe("POST /api/integrations/connections", () => {
  it("creates a bearer token connection", async () => {
    const res = await request(app)
      .post("/api/integrations/connections")
      .set(AUTH)
      .set("X-User-Id", USER_ID)
      .send({
        integrationSlug: "stripe",
        label: "My Stripe",
        credentials: { token: "sk_test_abc123" },
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.integrationSlug).toBe("stripe");
    expect(res.body.label).toBe("My Stripe");
    // Credentials should NOT be returned in the response
    expect(res.body.credentialsEncrypted).toBeUndefined();
  });

  it("returns 400 for missing integrationSlug", async () => {
    const res = await request(app)
      .post("/api/integrations/connections")
      .set(AUTH)
      .set("X-User-Id", USER_ID)
      .send({ label: "Test", credentials: { token: "abc" } });
    expect(res.status).toBe(400);
  });

  it("returns 400 for unknown integration slug", async () => {
    const res = await request(app)
      .post("/api/integrations/connections")
      .set(AUTH)
      .set("X-User-Id", USER_ID)
      .send({
        integrationSlug: "nonexistent-service",
        label: "Test",
        credentials: { token: "abc" },
      });
    expect(res.status).toBe(400);
  });

  it("returns 401 without Authorization header", async () => {
    const res = await request(app)
      .post("/api/integrations/connections")
      .send({ integrationSlug: "stripe", label: "Test", credentials: { token: "abc" } });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/integrations/connections/:id", () => {
  it("returns a connection by id", async () => {
    const created = await request(app)
      .post("/api/integrations/connections")
      .set(AUTH)
      .set("X-User-Id", USER_ID)
      .send({ integrationSlug: "github", label: "Work GitHub", credentials: { token: "ghp_abc" } });

    const res = await request(app)
      .get(`/api/integrations/connections/${created.body.id}`)
      .set(AUTH)
      .set("X-User-Id", USER_ID);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
  });

  it("returns 404 for a different user's connection", async () => {
    const created = await request(app)
      .post("/api/integrations/connections")
      .set(AUTH)
      .set("X-User-Id", USER_ID)
      .send({ integrationSlug: "github", label: "Test", credentials: { token: "ghp_abc" } });

    const res = await request(app)
      .get(`/api/integrations/connections/${created.body.id}`)
      .set(AUTH)
      .set("X-User-Id", "other-user");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/integrations/connections/:id", () => {
  it("updates the label", async () => {
    const created = await request(app)
      .post("/api/integrations/connections")
      .set(AUTH)
      .set("X-User-Id", USER_ID)
      .send({ integrationSlug: "hubspot", label: "Old Label", credentials: { token: "tok" } });

    const res = await request(app)
      .patch(`/api/integrations/connections/${created.body.id}`)
      .set(AUTH)
      .set("X-User-Id", USER_ID)
      .send({ label: "New Label" });
    expect(res.status).toBe(200);
    expect(res.body.label).toBe("New Label");
  });
});

describe("DELETE /api/integrations/connections/:id", () => {
  it("deletes a connection", async () => {
    const created = await request(app)
      .post("/api/integrations/connections")
      .set(AUTH)
      .set("X-User-Id", USER_ID)
      .send({ integrationSlug: "stripe", label: "Temp", credentials: { token: "sk_test" } });

    const delRes = await request(app)
      .delete(`/api/integrations/connections/${created.body.id}`)
      .set(AUTH)
      .set("X-User-Id", USER_ID);
    expect(delRes.status).toBe(204);

    const getRes = await request(app)
      .get(`/api/integrations/connections/${created.body.id}`)
      .set(AUTH)
      .set("X-User-Id", USER_ID);
    expect(getRes.status).toBe(404);
  });
});

describe("POST /api/integrations/connections/:id/default", () => {
  it("marks a connection as default", async () => {
    const created = await request(app)
      .post("/api/integrations/connections")
      .set(AUTH)
      .set("X-User-Id", USER_ID)
      .send({ integrationSlug: "stripe", label: "Primary Stripe", credentials: { token: "sk_test" } });

    const res = await request(app)
      .post(`/api/integrations/connections/${created.body.id}/default`)
      .set(AUTH)
      .set("X-User-Id", USER_ID);
    expect(res.status).toBe(200);
    expect(res.body.isDefault).toBe(true);
  });
});

describe("Connection filter by integration", () => {
  it("filters connections by integration slug", async () => {
    await request(app)
      .post("/api/integrations/connections")
      .set(AUTH)
      .set("X-User-Id", USER_ID)
      .send({ integrationSlug: "stripe", label: "S", credentials: { token: "s" } });

    await request(app)
      .post("/api/integrations/connections")
      .set(AUTH)
      .set("X-User-Id", USER_ID)
      .send({ integrationSlug: "github", label: "G", credentials: { token: "g" } });

    const res = await request(app)
      .get("/api/integrations/connections?integration=stripe")
      .set(AUTH)
      .set("X-User-Id", USER_ID);
    expect(res.status).toBe(200);
    expect(res.body.connections.every((c: { integrationSlug: string }) => c.integrationSlug === "stripe")).toBe(true);
    expect(res.body.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Webhook relay — public inbound endpoint, no auth required
// ---------------------------------------------------------------------------

describe("POST /api/webhooks/relay/:subscriptionId", () => {
  it("accepts and stores a matching event", async () => {
    const sub = webhookRelay.subscribe({
      userId: USER_ID,
      integrationSlug: "stripe",
      triggerId: "payment.succeeded",
      eventTypes: ["payment_intent.succeeded"],
      label: "Test Stripe Sub",
    });

    const res = await request(app)
      .post(`/api/webhooks/relay/${sub.id}`)
      .send({ type: "payment_intent.succeeded", id: "pi_123", data: {} });

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(res.body.matched).toBe(true);
    expect(res.body.eventId).toBeDefined();
  });

  it("returns matched=false for non-matching event type", async () => {
    const sub = webhookRelay.subscribe({
      userId: USER_ID,
      integrationSlug: "stripe",
      triggerId: "payment.succeeded",
      eventTypes: ["payment_intent.succeeded"],
      label: "Test",
    });

    const res = await request(app)
      .post(`/api/webhooks/relay/${sub.id}`)
      .send({ type: "customer.subscription.deleted" });

    expect(res.status).toBe(200);
    expect(res.body.matched).toBe(false);
  });

  it("returns matched=false for unknown subscription", async () => {
    const res = await request(app)
      .post("/api/webhooks/relay/unknown-subscription-id")
      .send({ type: "test" });

    expect(res.status).toBe(200);
    expect(res.body.matched).toBe(false);
  });

  it("returns 400 for non-object body", async () => {
    const sub = webhookRelay.subscribe({
      userId: USER_ID,
      integrationSlug: "stripe",
      triggerId: "payment.succeeded",
      eventTypes: [],
      label: "Test",
    });

    const res = await request(app)
      .post(`/api/webhooks/relay/${sub.id}`)
      .set("Content-Type", "application/json")
      .send(JSON.stringify("just a string"));

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Trigger subscriptions
// ---------------------------------------------------------------------------

describe("POST /api/integrations/triggers/subscriptions", () => {
  it("creates a webhook subscription", async () => {
    const res = await request(app)
      .post("/api/integrations/triggers/subscriptions")
      .set(AUTH)
      .set("X-User-Id", USER_ID)
      .send({
        integrationSlug: "github",
        triggerId: "push",
        eventTypes: ["push"],
        label: "My Repo Push",
      });

    expect(res.status).toBe(201);
    expect(res.body.subscription.id).toBeDefined();
    expect(res.body.relayUrl).toMatch(/^\/api\/webhooks\/relay\//);
  });

  it("returns 400 for unknown trigger", async () => {
    const res = await request(app)
      .post("/api/integrations/triggers/subscriptions")
      .set(AUTH)
      .set("X-User-Id", USER_ID)
      .send({
        integrationSlug: "github",
        triggerId: "nonexistent.trigger",
        eventTypes: [],
      });

    expect(res.status).toBe(400);
  });

  it("returns 400 for unknown integration", async () => {
    const res = await request(app)
      .post("/api/integrations/triggers/subscriptions")
      .set(AUTH)
      .set("X-User-Id", USER_ID)
      .send({ integrationSlug: "not-real", triggerId: "x", eventTypes: [] });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/integrations/triggers/subscriptions", () => {
  it("lists subscriptions for a user", async () => {
    await request(app)
      .post("/api/integrations/triggers/subscriptions")
      .set(AUTH)
      .set("X-User-Id", USER_ID)
      .send({ integrationSlug: "stripe", triggerId: "payment.succeeded", eventTypes: [] });

    const res = await request(app)
      .get("/api/integrations/triggers/subscriptions")
      .set(AUTH)
      .set("X-User-Id", USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });
});

describe("DELETE /api/integrations/triggers/subscriptions/:id", () => {
  it("deletes a subscription", async () => {
    const created = await request(app)
      .post("/api/integrations/triggers/subscriptions")
      .set(AUTH)
      .set("X-User-Id", USER_ID)
      .send({ integrationSlug: "github", triggerId: "issue.created", eventTypes: ["issues"] });

    const delRes = await request(app)
      .delete(`/api/integrations/triggers/subscriptions/${created.body.subscription.id}`)
      .set(AUTH)
      .set("X-User-Id", USER_ID);

    expect(delRes.status).toBe(204);
  });
});

describe("GET /api/integrations/triggers/subscriptions/:id/events", () => {
  it("returns events received on the relay", async () => {
    const subRes = await request(app)
      .post("/api/integrations/triggers/subscriptions")
      .set(AUTH)
      .set("X-User-Id", USER_ID)
      .send({ integrationSlug: "stripe", triggerId: "payment.succeeded", eventTypes: [] });

    const subId = subRes.body.subscription.id;

    // Send a relay event
    await request(app)
      .post(`/api/webhooks/relay/${subId}`)
      .send({ type: "payment_intent.succeeded", amount: 2000 });

    const eventsRes = await request(app)
      .get(`/api/integrations/triggers/subscriptions/${subId}/events`)
      .set(AUTH)
      .set("X-User-Id", USER_ID);

    expect(eventsRes.status).toBe(200);
    expect(eventsRes.body.total).toBe(1);
    expect(eventsRes.body.events[0].payload.amount).toBe(2000);
  });
});
