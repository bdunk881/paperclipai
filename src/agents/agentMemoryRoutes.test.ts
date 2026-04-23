jest.mock("../engine/llmProviders", () => ({ getProvider: jest.fn() }));
jest.mock("express-rate-limit", () => () => (_req: unknown, _res: unknown, next: () => void) => next());
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
import {
  resetAgentMemorySearchQuotaForTests,
  seedAgentMemorySearchQuotaForTests,
} from "./agentMemoryRoutes";

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
  resetAgentMemorySearchQuotaForTests();
  jest.restoreAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
});

describe("Agent memory routes", () => {
  it("rejects Agent Memory writes for Explore users", async () => {
    const res = await request(app)
      .post("/api/agents/agent-1/memory")
      .set(asAuth("free-user"))
      .set("X-Paperclip-Run-Id", "run-free-memory")
      .send({ key: "ctx", text: "hello" });

    expect(res.status).toBe(403);
    expect(res.body.tier).toBe("explore");
  });

  it("requires X-Paperclip-Run-Id for memory writes", async () => {
    grantPlan("flow-user", "flow");
    const res = await request(app)
      .post("/api/agents/agent-1/memory")
      .set(asAuth("flow-user"))
      .send({ key: "ctx", text: "hello" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/X-Paperclip-Run-Id/i);
  });

  it("stores and searches agent memory for Flow users", async () => {
    grantPlan("flow-user", "flow");

    const createRes = await request(app)
      .post("/api/agents/agent-1/memory")
      .set(asAuth("flow-user"))
      .set("X-Paperclip-Run-Id", "run-store-1")
      .send({ key: "customer-tone", text: "Customer prefers concise replies.", metadata: { source: "ticket" } });

    expect(createRes.status).toBe(201);
    expect(createRes.body.tier).toBe("flow");
    expect(createRes.body.entry.agentId).toBe("agent-1");

    const searchRes = await request(app)
      .get("/api/agents/agent-1/memory/search?q=concise")
      .set(asAuth("flow-user"));

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.results).toHaveLength(1);
    expect(searchRes.body.results[0].entry.key).toBe("customer-tone");
  });

  it("rejects shared memory on Flow", async () => {
    grantPlan("flow-user", "flow");

    const res = await request(app)
      .post("/api/agents/agent-1/memory")
      .set(asAuth("flow-user"))
      .set("X-Paperclip-Run-Id", "run-shared-pro")
      .send({ key: "ctx", text: "team data", scope: "shared" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Automate and Scale/i);
  });

  it("allows Automate shared memory to be queried across agents", async () => {
    grantPlan("automate-user", "automate");

    const createRes = await request(app)
      .post("/api/agents/agent-a/memory")
      .set(asAuth("automate-user"))
      .set("X-Paperclip-Run-Id", "run-shared-1")
      .send({ key: "playbook", text: "Escalate billing disputes to finance.", scope: "shared" });

    expect(createRes.status).toBe(201);
    expect(createRes.body.tier).toBe("automate");

    const searchRes = await request(app)
      .get("/api/agents/agent-b/memory/search?q=finance&includeShared=true")
      .set(asAuth("automate-user"));

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.results).toHaveLength(1);
    expect(searchRes.body.results[0].entry.scope).toBe("shared");
  });

  it("stores and queries knowledge graph facts for Flow users", async () => {
    grantPlan("flow-user", "flow");

    const createRes = await request(app)
      .post("/api/agents/agent-1/memory/kg")
      .set(asAuth("flow-user"))
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
      .set(asAuth("flow-user"));

    expect(queryRes.status).toBe(200);
    expect(queryRes.body.facts).toHaveLength(1);
    expect(queryRes.body.facts[0].predicate).toBe("auth_provider");
  });

  it("rejects heartbeat logs for Explore", async () => {
    const response = await request(app)
      .post("/api/agents/free-agent/memory/heartbeat-log")
      .set(asAuth("free-user"))
      .set("X-Paperclip-Run-Id", "run-heartbeat-0")
      .send({ summary: "Heartbeat 0", status: "completed" });

    expect(response.status).toBe(403);
    expect(response.body.tier).toBe("explore");
  });

  it("enforces Flow semantic search daily quotas", async () => {
    grantPlan("flow-user", "flow");

    const createRes = await request(app)
      .post("/api/agents/agent-1/memory")
      .set(asAuth("flow-user"))
      .set("X-Paperclip-Run-Id", "run-store-quota")
      .send({ key: "ctx", text: "quota seed" });

    expect(createRes.status).toBe(201);

    seedAgentMemorySearchQuotaForTests("flow-user", 100);
    const exhausted = await request(app)
      .get("/api/agents/agent-1/memory/search?q=quota")
      .set(asAuth("flow-user"));

    expect(exhausted.status).toBe(429);
    expect(exhausted.body.error).toMatch(/quota exceeded/i);
  });

  it("rejects writes when the Flow storage cap is exceeded", async () => {
    grantPlan("flow-user", "flow");
    jest.spyOn(agentMemoryStore, "getApproximateMemoryUsageBytes").mockResolvedValue(5 * 1024 * 1024 * 1024);

    const response = await request(app)
      .post("/api/agents/agent-1/memory")
      .set(asAuth("flow-user"))
      .set("X-Paperclip-Run-Id", "run-store-cap")
      .send({ key: "ctx", text: "value" });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/capacity exceeded/i);
  });

  it("rejects writes when the Flow knowledge graph entity limit is reached", async () => {
    grantPlan("flow-user", "flow");
    jest.spyOn(agentMemoryStore, "countKnowledgeFacts").mockResolvedValue(500);

    const response = await request(app)
      .post("/api/agents/agent-1/memory/kg")
      .set(asAuth("flow-user"))
      .set("X-Paperclip-Run-Id", "run-kg-cap")
      .send({
        subject: "AutoFlow",
        predicate: "memory_tier",
        object: "flow",
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/entity limit/i);
  });

  it("expires Flow heartbeat logs after 7 days", async () => {
    grantPlan("flow-user", "flow");
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-04-01T00:00:00.000Z"));

    const oldLog = await request(app)
      .post("/api/agents/agent-1/memory/heartbeat-log")
      .set(asAuth("flow-user"))
      .set("X-Paperclip-Run-Id", "run-heartbeat-old")
      .send({ summary: "Old heartbeat", status: "completed" });
    expect(oldLog.status).toBe(201);

    jest.setSystemTime(new Date("2026-04-09T00:00:00.000Z"));

    const freshLog = await request(app)
      .post("/api/agents/agent-1/memory/heartbeat-log")
      .set(asAuth("flow-user"))
      .set("X-Paperclip-Run-Id", "run-heartbeat-new")
      .send({ summary: "Fresh heartbeat", status: "completed" });
    expect(freshLog.status).toBe(201);

    const listRes = await request(app)
      .get("/api/agents/agent-1/memory/heartbeat-log")
      .set(asAuth("flow-user"));

    expect(listRes.status).toBe(200);
    expect(listRes.body.logs).toHaveLength(1);
    expect(listRes.body.logs[0].summary).toBe("Fresh heartbeat");
  });
});
