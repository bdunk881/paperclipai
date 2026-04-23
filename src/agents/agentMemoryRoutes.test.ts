jest.mock("../engine/llmProviders", () => ({ getProvider: jest.fn() }));
jest.mock("../auth/authMiddleware", () => ({
  requireAuth: (
    req: { headers: { authorization?: string }; auth?: { sub: string; email?: string } },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void
  ) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or malformed Authorization header." });
      return;
    }
    req.auth = { sub: auth.slice(7), email: "test@example.com" };
    next();
  },
}));

import request from "supertest";
import app from "../app";
import { agentMemoryStore } from "./agentMemoryStore";
import { subscriptionStore } from "../billing/subscriptionStore";

function asAuth(userId = "agent-memory-user") {
  return { Authorization: `Bearer ${userId}` };
}

function grantPlan(userId: string, tier: "flow" | "automate" | "scale") {
  subscriptionStore.upsert({
    id: `sub-${userId}`,
    stripeSubscriptionId: `stripe-sub-${userId}`,
    stripeCustomerId: `stripe-customer-${userId}`,
    userId,
    email: `${userId}@example.com`,
    tier,
    accessLevel: "active",
    status: "active",
    currentPeriodStart: "2026-04-01T00:00:00.000Z",
    currentPeriodEnd: "2026-05-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    trialEnd: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });
}

beforeEach(() => {
  agentMemoryStore.clear();
  subscriptionStore.clear();
});

describe("Agent memory routes", () => {
  it("rejects persistent memory writes for free users", async () => {
    const res = await request(app)
      .post("/api/agents/agent-1/memory")
      .set(asAuth("free-user"))
      .set("X-Paperclip-Run-Id", "run-free-memory")
      .send({ key: "ctx", text: "hello" });

    expect(res.status).toBe(403);
    expect(res.body.plan).toBe("free");
  });

  it("requires X-Paperclip-Run-Id for memory writes", async () => {
    grantPlan("pro-user", "flow");
    const res = await request(app)
      .post("/api/agents/agent-1/memory")
      .set(asAuth("pro-user"))
      .send({ key: "ctx", text: "hello" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/X-Paperclip-Run-Id/i);
  });

  it("stores and searches agent memory for paid users", async () => {
    grantPlan("pro-user", "flow");

    const createRes = await request(app)
      .post("/api/agents/agent-1/memory")
      .set(asAuth("pro-user"))
      .set("X-Paperclip-Run-Id", "run-store-1")
      .send({ key: "customer-tone", text: "Customer prefers concise replies.", metadata: { source: "ticket" } });

    expect(createRes.status).toBe(201);
    expect(createRes.body.plan).toBe("pro");
    expect(createRes.body.entry.agentId).toBe("agent-1");

    const searchRes = await request(app)
      .get("/api/agents/agent-1/memory/search?q=concise")
      .set(asAuth("pro-user"));

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.results).toHaveLength(1);
    expect(searchRes.body.results[0].entry.key).toBe("customer-tone");
  });

  it("rejects shared memory on non-enterprise plans", async () => {
    grantPlan("pro-user", "flow");

    const res = await request(app)
      .post("/api/agents/agent-1/memory")
      .set(asAuth("pro-user"))
      .set("X-Paperclip-Run-Id", "run-shared-pro")
      .send({ key: "ctx", text: "team data", scope: "shared" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Enterprise/i);
  });

  it("allows enterprise shared memory to be queried across agents", async () => {
    grantPlan("enterprise-user", "scale");

    const createRes = await request(app)
      .post("/api/agents/agent-a/memory")
      .set(asAuth("enterprise-user"))
      .set("X-Paperclip-Run-Id", "run-shared-1")
      .send({ key: "playbook", text: "Escalate billing disputes to finance.", scope: "shared" });

    expect(createRes.status).toBe(201);
    expect(createRes.body.plan).toBe("enterprise");

    const searchRes = await request(app)
      .get("/api/agents/agent-b/memory/search?q=finance&includeShared=true")
      .set(asAuth("enterprise-user"));

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.results).toHaveLength(1);
    expect(searchRes.body.results[0].entry.scope).toBe("shared");
  });

  it("stores and queries knowledge graph facts for paid users", async () => {
    grantPlan("pro-user", "automate");

    const createRes = await request(app)
      .post("/api/agents/agent-1/memory/kg")
      .set(asAuth("pro-user"))
      .set("X-Paperclip-Run-Id", "run-kg-1")
      .send({
        subject: "AutoFlow",
        predicate: "auth_provider",
        object: "Microsoft Entra External ID",
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.fact.subject).toBe("AutoFlow");

    const queryRes = await request(app)
      .get("/api/agents/agent-1/memory/kg/query?q=entra")
      .set(asAuth("pro-user"));

    expect(queryRes.status).toBe(200);
    expect(queryRes.body.facts).toHaveLength(1);
    expect(queryRes.body.facts[0].predicate).toBe("auth_provider");
  });

  it("stores heartbeat logs for free users and caps them at the latest 10", async () => {
    for (let index = 0; index < 12; index += 1) {
      const response = await request(app)
        .post("/api/agents/free-agent/memory/heartbeat-log")
        .set(asAuth("free-user"))
        .set("X-Paperclip-Run-Id", `run-heartbeat-${index}`)
        .send({ summary: `Heartbeat ${index}`, status: "completed" });
      expect(response.status).toBe(201);
      expect(response.body.plan).toBe("free");
    }

    const listRes = await request(app)
      .get("/api/agents/free-agent/memory/heartbeat-log")
      .set(asAuth("free-user"));

    expect(listRes.status).toBe(200);
    expect(listRes.body.logs).toHaveLength(10);
    expect(listRes.body.logs[0].summary).toBe("Heartbeat 11");
    expect(listRes.body.logs[9].summary).toBe("Heartbeat 2");
  });
});
