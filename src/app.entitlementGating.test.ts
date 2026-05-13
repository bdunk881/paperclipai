/**
 * HEL-77: Per-route entitlement gating smoke tests.
 *
 * Verifies that each of the 5 new route gates returns 402 when the workspace is
 * at or over its plan limit and allows through when there is headroom.
 * Also verifies that GET /api/observability/events applies the logRetentionDays
 * cutoff as a `since` filter rather than blocking with a 402.
 */

jest.mock("./engine/llmProviders", () => ({
  getProvider: jest.fn(),
}));

jest.mock("express-rate-limit", () => {
  const passThrough = (_req: unknown, _res: unknown, next: () => void) => next();
  return { __esModule: true, default: jest.fn(() => passThrough) };
});

jest.mock("./auth/authMiddleware", () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.auth = { sub: "test-user-ent" };
    next();
  },
  requireAuthOrQaBypass: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.auth = { sub: "test-user-ent" };
    next();
  },
}));

jest.mock("./db/postgres", () => ({
  getPostgresPool: jest.fn(() => ({})),
  isPostgresConfigured: jest.fn(() => false),
  isPostgresPersistenceEnabled: jest.fn(() => false),
  inMemoryAllowed: jest.fn(() => true),
}));

// HEL-77: entitlement auto-mock — defaults to "automate" tier (all limits high).
// Tests that exercise the denial path call entitlementStore.upsert(ws, "explore")
// to flip the workspace to the free tier before the request.
jest.mock("./billing/entitlements");

const WS = "test-ws-ent";

const makeWorkspaceMiddleware = () =>
  (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.workspace = { id: WS, role: "admin" };
    req.workspaceId = WS;
    next();
  };

jest.mock("./middleware/workspaceResolver", () => ({
  createWorkspaceResolver: jest.fn(() => makeWorkspaceMiddleware()),
  createExplicitWorkspaceHeaderResolver: jest.fn(() => makeWorkspaceMiddleware()),
}));

import request from "supertest";
import app from "./app";
import { entitlementStore } from "./billing/entitlements";
import { controlPlaneStore } from "./controlPlane/controlPlaneStore";
import { integrationCredentialStore } from "./integrations/integrationCredentialStore";
import { runStore } from "./engine/runStore";
import { observabilityStore } from "./observability/store";

const PAPERCLIP_RUN_ID = "run-id-test-001";

beforeEach(() => {
  entitlementStore.clear();
  integrationCredentialStore.clear();
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// agentCap — POST /api/control-plane/deployments/workflow
// ---------------------------------------------------------------------------

describe("agentCap gate — POST /api/control-plane/deployments/workflow", () => {
  it("returns 402 with entitlement_exceeded payload when agent count is at cap", async () => {
    // Explore tier: agentCap=1. Spy returns 1 existing agent → at cap.
    entitlementStore.upsert(WS, "explore");
    jest.spyOn(controlPlaneStore, "listAllAgents").mockReturnValue(
      [{ id: "a1" }] as ReturnType<typeof controlPlaneStore.listAllAgents>
    );

    const res = await request(app)
      .post("/api/control-plane/deployments/workflow")
      .set("Authorization", "Bearer test-user-ent")
      .set("X-Paperclip-Run-Id", PAPERCLIP_RUN_ID)
      .send({ templateId: "any-template" });

    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({
      code: "entitlement_exceeded",
      feature: "agentCap",
      currentTier: "explore",
    });
    expect(res.body.upgradeTo).not.toBeNull();
  });

  it("passes through the gate when under the agent cap", async () => {
    // Automate tier: agentCap=10. Spy returns 0 existing agents → under cap.
    jest.spyOn(controlPlaneStore, "listAllAgents").mockReturnValue([]);

    const res = await request(app)
      .post("/api/control-plane/deployments/workflow")
      .set("Authorization", "Bearer test-user-ent")
      .set("X-Paperclip-Run-Id", PAPERCLIP_RUN_ID)
      .send({ templateId: "nonexistent-template" });

    // Gate passes; handler fails with 404 (template not found) — not 402.
    expect(res.status).not.toBe(402);
  });
});

// ---------------------------------------------------------------------------
// integrationCap — POST /api/integrations/connections
// ---------------------------------------------------------------------------

describe("integrationCap gate — POST /api/integrations/connections", () => {
  it("returns 402 when connection count is at cap", async () => {
    // Explore tier: integrationCap=1. Spy returns 1 existing connection → at cap.
    entitlementStore.upsert(WS, "explore");
    jest.spyOn(integrationCredentialStore, "list").mockReturnValue(
      [{ id: "c1", userId: "test-user-ent", integrationSlug: "slack", label: "Slack", isDefault: false, createdAt: "", updatedAt: "" }]
    );

    const res = await request(app)
      .post("/api/integrations/connections")
      .set("Authorization", "Bearer test-user-ent")
      .send({ integrationSlug: "slack", label: "Slack", credentials: { apiKey: "xoxb-test" } });

    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({
      code: "entitlement_exceeded",
      feature: "integrationCap",
      currentTier: "explore",
    });
  });

  it("passes through the gate when under the integration cap", async () => {
    // Automate tier: integrationCap=10. No existing connections → under cap.
    jest.spyOn(integrationCredentialStore, "list").mockReturnValue([]);

    const res = await request(app)
      .post("/api/integrations/connections")
      .set("Authorization", "Bearer test-user-ent")
      .send({ integrationSlug: "slack", label: "Slack", credentials: { apiKey: "xoxb-test" } });

    // Gate passes; result depends on the handler (may succeed or return 400/404).
    expect(res.status).not.toBe(402);
  });
});

// ---------------------------------------------------------------------------
// runsPerMonth — POST /api/runs
// ---------------------------------------------------------------------------

describe("runsPerMonth gate — POST /api/runs", () => {
  it("returns 402 when monthly run count is at the plan limit", async () => {
    // Explore tier: runsPerMonth=25. Spy returns 25 → at cap.
    entitlementStore.upsert(WS, "explore");
    jest.spyOn(runStore, "countByWorkspaceCurrentMonth").mockResolvedValue(25);

    const res = await request(app)
      .post("/api/runs")
      .set("Authorization", "Bearer test-user-ent")
      .send({ templateId: "any-template" });

    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({
      code: "entitlement_exceeded",
      feature: "runsPerMonth",
      currentTier: "explore",
    });
  });

  it("passes through the gate when under the monthly run limit", async () => {
    // Automate tier: runsPerMonth=1000. 0 runs this month → under cap.
    jest.spyOn(runStore, "countByWorkspaceCurrentMonth").mockResolvedValue(0);

    const res = await request(app)
      .post("/api/runs")
      .set("Authorization", "Bearer test-user-ent")
      .send({ templateId: "nonexistent-template" });

    // Gate passes; handler returns 404 (template not found) — not 402.
    expect(res.status).not.toBe(402);
  });
});

// ---------------------------------------------------------------------------
// approvalTierMax — PUT /api/approval-policies/:actionType
// ---------------------------------------------------------------------------

describe("approvalTierMax gate — PUT /api/approval-policies/:actionType", () => {
  it("returns 402 when requested mode tier exceeds the plan max", async () => {
    // Explore tier: approvalTierMax=0 (only auto_approve allowed).
    // require_approval maps to tier 2 → 2 > 0 → deny.
    entitlementStore.upsert(WS, "explore");

    const res = await request(app)
      .put("/api/approval-policies/contracts")
      .set("Authorization", "Bearer test-user-ent")
      .send({ mode: "require_approval" });

    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({
      code: "entitlement_exceeded",
      feature: "approvalTierMax",
      currentTier: "explore",
    });
  });

  it("also denies notify_only on explore (tier 1 > 0)", async () => {
    entitlementStore.upsert(WS, "explore");

    const res = await request(app)
      .put("/api/approval-policies/contracts")
      .set("Authorization", "Bearer test-user-ent")
      .send({ mode: "notify_only" });

    expect(res.status).toBe(402);
  });

  it("allows require_approval on automate plan (tier 2 <= 2)", async () => {
    // automate tier: approvalTierMax=2 — require_approval (tier 2) is allowed.
    const res = await request(app)
      .put("/api/approval-policies/contracts")
      .set("Authorization", "Bearer test-user-ent")
      .send({ mode: "require_approval" });

    // Gate passes; handler persists the policy.
    expect(res.status).not.toBe(402);
    expect(res.status).toBe(200);
  });

  it("allows notify_only on flow plan (tier 1 <= 1)", async () => {
    // flow tier: approvalTierMax=1 — notify_only (tier 1) is allowed.
    entitlementStore.upsert(WS, "flow");

    const res = await request(app)
      .put("/api/approval-policies/contracts")
      .set("Authorization", "Bearer test-user-ent")
      .send({ mode: "notify_only" });

    expect(res.status).not.toBe(402);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// logRetentionDays — GET /api/observability/events (query-time filter)
// ---------------------------------------------------------------------------

describe("logRetentionDays filter — GET /api/observability/events", () => {
  it("passes a `since` cutoff to listEvents based on the workspace's retention entitlement", async () => {
    // Spy on the store so we can inspect the query params without needing real events.
    const listEventsSpy = jest.spyOn(observabilityStore, "listEvents").mockResolvedValue({
      events: [],
      nextCursor: null,
      hasMore: false,
      generatedAt: new Date().toISOString(),
    });

    // Explore tier: logRetentionDays=14. Expect `since` ≈ 14 days ago.
    entitlementStore.upsert(WS, "explore");

    await request(app)
      .get("/api/observability/events")
      .set("Authorization", "Bearer test-user-ent");

    expect(listEventsSpy).toHaveBeenCalledTimes(1);
    const query = listEventsSpy.mock.calls[0]?.[0];
    expect(query).toBeDefined();
    expect(query?.since).toBeDefined();

    // `since` should be within ~1 second of 14 days ago.
    const expectedCutoff = new Date();
    expectedCutoff.setUTCDate(expectedCutoff.getUTCDate() - 14);
    const actualCutoff = new Date(query!.since!);
    const diffMs = Math.abs(actualCutoff.getTime() - expectedCutoff.getTime());
    expect(diffMs).toBeLessThan(5_000); // within 5 s tolerance
  });

  it("uses a longer retention window on higher-tier plans", async () => {
    const listEventsSpy = jest.spyOn(observabilityStore, "listEvents").mockResolvedValue({
      events: [],
      nextCursor: null,
      hasMore: false,
      generatedAt: new Date().toISOString(),
    });

    // Scale tier: logRetentionDays=365.
    entitlementStore.upsert(WS, "scale");

    await request(app)
      .get("/api/observability/events")
      .set("Authorization", "Bearer test-user-ent");

    const query = listEventsSpy.mock.calls[0]?.[0];
    const expectedCutoff = new Date();
    expectedCutoff.setUTCDate(expectedCutoff.getUTCDate() - 365);
    const actualCutoff = new Date(query!.since!);
    const diffMs = Math.abs(actualCutoff.getTime() - expectedCutoff.getTime());
    expect(diffMs).toBeLessThan(5_000);
  });
});
