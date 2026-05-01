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
  requireAuthOrQaBypass: (
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

  it("filters ticket_close searches by entry type and tags with relevant ranking", async () => {
    grantPlan("flow-user", "flow");

    await agentMemoryStore.createTicketCloseEntry({
      userId: "flow-user",
      agentId: "agent-1",
      runId: "run-ticket-memory-1",
      ticketId: "ALT-100",
      ticketUrl: "/tickets/ALT-100",
      closedAt: "2026-04-01T00:00:00.000Z",
      taskSummary: "Resolved billing reconciliation failure for enterprise workspace.",
      agentContribution: "Investigated duplicate invoice joins and patched the export query.",
      keyLearnings: "Billing sync regressions cluster around invoice joins and reconciliation tags.",
      artifactRefs: ["https://example.com/artifacts/billing-fix"],
      tags: ["billing", "reconciliation"],
      tier: "flow",
    });

    await agentMemoryStore.createTicketCloseEntry({
      userId: "flow-user",
      agentId: "agent-1",
      runId: "run-ticket-memory-2",
      ticketId: "ALT-101",
      ticketUrl: "/tickets/ALT-101",
      closedAt: "2026-04-02T00:00:00.000Z",
      taskSummary: "Shipped UI polish for queue filters.",
      agentContribution: "Adjusted spacing and button states.",
      keyLearnings: "Visual polish tasks rarely share billing semantics.",
      artifactRefs: ["https://example.com/artifacts/ui-fix"],
      tags: ["frontend", "ux"],
      tier: "flow",
    });

    const searchRes = await request(app)
      .get("/api/agents/agent-1/memory/search?q=billing reconciliation&entryType=ticket_close&tags=billing")
      .set(asAuth("flow-user"));

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.results).toHaveLength(1);
    expect(searchRes.body.results[0].entry.entryType).toBe("ticket_close");
    expect(searchRes.body.results[0].entry.metadata.ticket_id).toBe("ALT-100");
  });

  it("writes ticket_close entries through the dedicated route and filters by ticketId", async () => {
    grantPlan("flow-user", "flow");

    const createRes = await request(app)
      .post("/api/agents/agent-1/memory/ticket-close")
      .set(asAuth("flow-user"))
      .set("X-Paperclip-Run-Id", "run-ticket-close-route")
      .send({
        ticketId: "ALT-222",
        ticketUrl: "/tickets/ALT-222",
        closedAt: "2026-04-22T00:00:00.000Z",
        taskSummary: "Closed queue memory regression.",
        agentContribution: "Added ticket-scoped memory filters and a strict writer route.",
        keyLearnings: "Ticket-close writes should stay append-only on the agent memory store.",
        artifactRefs: ["https://example.com/pr/222"],
        tags: ["memory", "queue"],
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.entry.entryType).toBe("ticket_close");
    expect(createRes.body.entry.metadata.ticket_id).toBe("ALT-222");

    const searchRes = await request(app)
      .get("/api/agents/agent-1/memory/search?q=append-only&entryType=ticket_close&ticketId=ALT-222")
      .set(asAuth("flow-user"));

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.results).toHaveLength(1);
    expect(searchRes.body.results[0].entry.metadata.ticket_id).toBe("ALT-222");
  });

  it("isolates layered memory by workspace tenant", async () => {
    grantPlan("automate-user", "automate");

    const createRes = await request(app)
      .post("/api/agents/agent-a/memory")
      .set(asAuth("automate-user"))
      .set("X-Paperclip-Run-Id", "run-company-layer-1")
      .send({
        workspaceId: "workspace-alpha",
        memoryLayer: "company",
        key: "mission",
        text: "Alpha only strategy memo",
      });

    expect(createRes.status).toBe(201);

    const alphaSearch = await request(app)
      .get("/api/agents/agent-b/memory/search?q=&workspaceId=workspace-alpha")
      .set(asAuth("automate-user"));
    const betaSearch = await request(app)
      .get("/api/agents/agent-b/memory/search?q=&workspaceId=workspace-beta")
      .set(asAuth("automate-user"));

    expect(alphaSearch.status).toBe(200);
    expect(alphaSearch.body.results).toHaveLength(1);
    expect(betaSearch.status).toBe(200);
    expect(betaSearch.body.results).toHaveLength(0);
  });

  it("scopes team-layer memory to the matching team only", async () => {
    grantPlan("automate-user", "automate");

    const createRes = await request(app)
      .post("/api/agents/agent-a/memory")
      .set(asAuth("automate-user"))
      .set("X-Paperclip-Run-Id", "run-team-layer-1")
      .send({
        workspaceId: "workspace-alpha",
        memoryLayer: "team",
        teamId: "team-growth",
        key: "okr",
        text: "Growth team OKR is 20% activation lift",
      });

    expect(createRes.status).toBe(201);

    const growthSearch = await request(app)
      .get("/api/agents/agent-b/memory/search?q=&workspaceId=workspace-alpha&teamId=team-growth")
      .set(asAuth("automate-user"));
    const productSearch = await request(app)
      .get("/api/agents/agent-b/memory/search?q=&workspaceId=workspace-alpha&teamId=team-product")
      .set(asAuth("automate-user"));

    expect(growthSearch.status).toBe(200);
    expect(growthSearch.body.results).toHaveLength(1);
    expect(productSearch.status).toBe(200);
    expect(productSearch.body.results).toHaveLength(0);
  });

  it("replays workspace state from the append-only event log", async () => {
    grantPlan("automate-user", "automate");

    await request(app)
      .post("/api/agents/agent-a/memory")
      .set(asAuth("automate-user"))
      .set("X-Paperclip-Run-Id", "run-state-entry")
      .send({
        workspaceId: "workspace-alpha",
        memoryLayer: "company",
        key: "brand-voice",
        text: "Confident and direct",
      });

    await request(app)
      .post("/api/agents/agent-a/memory/kg")
      .set(asAuth("automate-user"))
      .set("X-Paperclip-Run-Id", "run-state-kg")
      .send({
        workspaceId: "workspace-alpha",
        memoryLayer: "company",
        subject: "AutoFlow",
        predicate: "brand_voice",
        object: "Confident and direct",
      });

    const stateRes = await request(app)
      .get("/api/agents/agent-b/memory/state?workspaceId=workspace-alpha")
      .set(asAuth("automate-user"));

    expect(stateRes.status).toBe(200);
    expect(stateRes.body.state.entries).toHaveLength(1);
    expect(stateRes.body.state.facts).toHaveLength(1);
    expect(stateRes.body.state.events.length).toBeGreaterThanOrEqual(2);
  });

  it("archives old workspace memory and hides it from replay and search", async () => {
    grantPlan("automate-user", "automate");

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-04-01T00:00:00.000Z"));

    await request(app)
      .post("/api/agents/agent-a/memory")
      .set(asAuth("automate-user"))
      .set("X-Paperclip-Run-Id", "run-archive-entry")
      .send({
        workspaceId: "workspace-alpha",
        memoryLayer: "company",
        key: "decision",
        text: "Archive me later",
      });

    jest.setSystemTime(new Date("2026-04-20T00:00:00.000Z"));

    const archiveRes = await request(app)
      .post("/api/agents/agent-a/memory/archive")
      .set(asAuth("automate-user"))
      .set("X-Paperclip-Run-Id", "run-archive-memory")
      .send({
        workspaceId: "workspace-alpha",
        olderThan: "2026-04-10T00:00:00.000Z",
      });

    expect(archiveRes.status).toBe(200);
    expect(archiveRes.body.archived.archivedEntries).toBe(1);

    const searchRes = await request(app)
      .get("/api/agents/agent-b/memory/search?q=archive&workspaceId=workspace-alpha")
      .set(asAuth("automate-user"));
    const stateRes = await request(app)
      .get("/api/agents/agent-b/memory/state?workspaceId=workspace-alpha")
      .set(asAuth("automate-user"));

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.results).toHaveLength(0);
    expect(stateRes.status).toBe(200);
    expect(stateRes.body.state.entries).toHaveLength(0);
  });
});
