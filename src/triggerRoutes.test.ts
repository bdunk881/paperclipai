/**
 * HEL-710: API contract tests for the browser run-trigger endpoints:
 * - POST /api/templates/:id/trigger-token   (authenticated mint)
 * - POST /api/realtime/trigger/:templateId  (public, scoped-token start)
 */

jest.mock("./engine/llmProviders", () => ({
  getProvider: jest.fn(),
}));

// Deterministic entitlements (manual mock provides a generous runsPerMonth) so
// the quota gate on the public trigger endpoint doesn't depend on Postgres.
jest.mock("./billing/entitlements");

const mockQueueAdd = jest.fn().mockResolvedValue({ id: "job-1" });
const mockQueueGetJob = jest.fn().mockResolvedValue(null);
jest.mock("./queue/queues", () => ({
  getRunQueue: jest.fn(() => ({ add: mockQueueAdd, getJob: mockQueueGetJob })),
  getDlqQueue: jest.fn(() => null),
  resetRunQueueForTests: jest.fn(),
  resetDlqQueueForTests: jest.fn(),
  addRunJob: (
    queue: { add: (...args: unknown[]) => unknown },
    name: string,
    payload: unknown,
    opts: unknown,
  ) => queue.add(name, payload, opts),
  isRunPriority: (v: unknown) =>
    v === "critical" || v === "high" || v === "normal" || v === "low",
}));

// req.workspace with owner role so the MINT endpoint's requireRole() passes.
const TEST_WORKSPACE = "11111111-1111-4111-8111-111111111111";
jest.mock("./middleware/workspaceResolver", () => ({
  createWorkspaceResolver: jest.fn(() => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.workspace = { id: "11111111-1111-4111-8111-111111111111", role: "owner" };
    req.workspaceId = "11111111-1111-4111-8111-111111111111";
    next();
  }),
  createExplicitWorkspaceHeaderResolver: jest.fn(() => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.workspace = { id: "11111111-1111-4111-8111-111111111111", role: "owner" };
    req.workspaceId = "11111111-1111-4111-8111-111111111111";
    next();
  }),
}));

jest.mock("./auth/authMiddleware", () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.auth = { sub: "test-user-id", email: "test@example.com" };
    next();
  },
  requireAuthOrQaBypass: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.auth = { sub: "test-user-id", email: "test@example.com" };
    next();
  },
}));

import request from "supertest";
import app from "./app";
import { runStore } from "./engine/runStore";
import {
  mintRunTriggerToken,
  verifyRunTriggerToken,
  verifyRealtimeToken,
} from "./engine/realtimeToken";

const SECRET = "test-realtime-secret-at-least-32-bytes-long!!";
const TEMPLATE_ID = "tpl-support-bot"; // built-in, resolves without a DB

beforeEach(async () => {
  await runStore.clear();
  mockQueueAdd.mockReset();
  mockQueueAdd.mockResolvedValue({ id: "job-1" });
  mockQueueGetJob.mockReset();
  mockQueueGetJob.mockResolvedValue(null);
  process.env.REALTIME_TOKEN_SECRET = SECRET;
});

describe("POST /api/templates/:id/trigger-token", () => {
  it("mints a trigger token scoped to the template + workspace", async () => {
    const res = await request(app).post(`/api/templates/${TEMPLATE_ID}/trigger-token`);
    expect(res.status).toBe(200);
    expect(res.body.templateId).toBe(TEMPLATE_ID);
    expect(typeof res.body.token).toBe("string");
    const verified = verifyRunTriggerToken(res.body.token);
    expect(verified).toMatchObject({
      template_id: TEMPLATE_ID,
      workspace_id: TEST_WORKSPACE,
      user_id: "test-user-id",
      scope: "run_trigger",
    });
  });

  it("returns 404 for an unknown template", async () => {
    const res = await request(app).post("/api/templates/does-not-exist/trigger-token");
    expect(res.status).toBe(404);
  });

  it("returns 503 when REALTIME_TOKEN_SECRET is not configured", async () => {
    delete process.env.REALTIME_TOKEN_SECRET;
    const res = await request(app).post(`/api/templates/${TEMPLATE_ID}/trigger-token`);
    expect(res.status).toBe(503);
  });
});

describe("POST /api/realtime/trigger/:templateId", () => {
  function triggerToken(templateId = TEMPLATE_ID): string {
    return mintRunTriggerToken({
      workspaceId: TEST_WORKSPACE,
      templateId,
      userId: "test-user-id",
    }).token;
  }

  it("starts a run and returns the runId + a read token", async () => {
    const res = await request(app)
      .post(`/api/realtime/trigger/${TEMPLATE_ID}`)
      .set("Authorization", `Bearer ${triggerToken()}`)
      .send({ input: { message: "hello" } });

    expect(res.status).toBe(202);
    expect(typeof res.body.runId).toBe("string");
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    // The returned read token grants the new run's stream.
    const read = verifyRealtimeToken(res.body.token);
    expect(read.run_id).toBe(res.body.runId);
    expect(read.scope).toBe("run_read");
    // The run was actually recorded.
    const run = await runStore.get(res.body.runId, TEST_WORKSPACE);
    expect(run?.templateId).toBe(TEMPLATE_ID);
  });

  it("returns 401 for a missing / invalid token", async () => {
    const res = await request(app).post(`/api/realtime/trigger/${TEMPLATE_ID}`).send({});
    expect(res.status).toBe(401);
  });

  it("returns 403 when the token is for a different template", async () => {
    const res = await request(app)
      .post(`/api/realtime/trigger/${TEMPLATE_ID}`)
      .set("Authorization", `Bearer ${triggerToken("some-other-template")}`)
      .send({});
    expect(res.status).toBe(403);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("returns 503 when REALTIME_TOKEN_SECRET is not configured", async () => {
    const token = triggerToken();
    delete process.env.REALTIME_TOKEN_SECRET;
    const res = await request(app)
      .post(`/api/realtime/trigger/${TEMPLATE_ID}`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(503);
  });
});
