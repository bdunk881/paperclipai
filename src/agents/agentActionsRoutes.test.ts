/**
 * Coverage for the agent actions routes (Wave 5). The underlying
 * ticketStore + presence + redis are mocked at the module boundary so
 * these stay pure HTTP-shape tests.
 */

jest.mock("../tickets/ticketStore", () => ({
  ticketStore: { create: jest.fn() },
}));

jest.mock("./agentPresence", () => ({
  setAgentPresence: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../queue/redisClient", () => ({
  getRedisClient: jest.fn().mockReturnValue(null),
}));

jest.mock("../middleware/workspaceContext", () => ({
  // Bypass the real withWorkspaceContext (which calls pool.connect)
  // and feed the inner fn a stub client whose query returns whatever
  // we configure per-test via mockClientQuery.
  withWorkspaceContext: jest.fn(async (_pool, _ctx, fn) =>
    fn({ query: mockClientQuery } as unknown as Parameters<typeof fn>[0]),
  ),
}));

import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { createAgentActionsRoutes } from "./agentActionsRoutes";
import { ticketStore } from "../tickets/ticketStore";

const mockedCreate = ticketStore.create as jest.Mock;
const mockClientQuery = jest.fn();

const stubPool = { query: jest.fn() } as unknown as Parameters<typeof createAgentActionsRoutes>[0];

function buildApp(authOverrides: { sub?: string; workspaceId?: string } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (authOverrides.sub) {
      (req as Request & { auth?: { sub: string } }).auth = { sub: authOverrides.sub };
    }
    if (authOverrides.workspaceId) {
      (req as Request & { workspace?: { id: string; role: string } }).workspace = {
        id: authOverrides.workspaceId,
        role: "owner",
      };
    }
    next();
  });
  app.use("/api/agents", createAgentActionsRoutes(stubPool));
  return app;
}

const WS = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  mockedCreate.mockReset();
  mockClientQuery.mockReset();
  // Default: agent lookup returns a row.
  mockClientQuery.mockResolvedValue({ rows: [{ id: AGENT, name: "Aaron" }] });
});

describe("POST /api/agents/:agentId/check-in", () => {
  it("returns 401 with no auth", async () => {
    const res = await request(buildApp({ workspaceId: WS })).post(
      `/api/agents/${AGENT}/check-in`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 on a malformed agent ID", async () => {
    const res = await request(buildApp({ sub: "user-1", workspaceId: WS })).post(
      "/api/agents/not-a-uuid/check-in",
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when the agent doesn't belong to this workspace", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp({ sub: "user-1", workspaceId: WS })).post(
      `/api/agents/${AGENT}/check-in`,
    );
    expect(res.status).toBe(404);
  });

  it("creates a ticket assigned to the agent on success", async () => {
    mockedCreate.mockResolvedValueOnce({
      ticket: { id: "ticket-1" },
    });
    const res = await request(buildApp({ sub: "user-1", workspaceId: WS })).post(
      `/api/agents/${AGENT}/check-in`,
    );
    expect(res.status).toBe(201);
    expect(res.body.ticketId).toBe("ticket-1");
    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        creatorId: "user-1",
        assignees: [{ type: "agent", id: AGENT, role: "primary" }],
        title: expect.stringContaining("Self check-in"),
      }),
    );
  });
});

describe("POST /api/agents/:agentId/handoff", () => {
  it("returns 401 with no auth", async () => {
    const res = await request(buildApp({ workspaceId: WS }))
      .post(`/api/agents/${AGENT}/handoff`)
      .send({ title: "Do X" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when title is missing", async () => {
    const res = await request(buildApp({ sub: "user-1", workspaceId: WS }))
      .post(`/api/agents/${AGENT}/handoff`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/);
  });

  it("returns 400 when title is too long", async () => {
    const res = await request(buildApp({ sub: "user-1", workspaceId: WS }))
      .post(`/api/agents/${AGENT}/handoff`)
      .send({ title: "x".repeat(201) });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the agent doesn't exist in this workspace", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp({ sub: "user-1", workspaceId: WS }))
      .post(`/api/agents/${AGENT}/handoff`)
      .send({ title: "Do X" });
    expect(res.status).toBe(404);
  });

  it("creates a ticket with the provided title/description/priority on success", async () => {
    mockedCreate.mockResolvedValueOnce({ ticket: { id: "t-handoff-1" } });
    const res = await request(buildApp({ sub: "user-1", workspaceId: WS }))
      .post(`/api/agents/${AGENT}/handoff`)
      .send({
        title: "Triage the latest support escalation",
        description: "Pull the thread, summarize, decide next step.",
        priority: "high",
      });
    expect(res.status).toBe(201);
    expect(res.body.ticketId).toBe("t-handoff-1");
    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Triage the latest support escalation",
        priority: "high",
        assignees: [{ type: "agent", id: AGENT, role: "primary" }],
      }),
    );
  });

  it("defaults priority to 'medium' when not provided", async () => {
    mockedCreate.mockResolvedValueOnce({ ticket: { id: "t" } });
    await request(buildApp({ sub: "user-1", workspaceId: WS }))
      .post(`/api/agents/${AGENT}/handoff`)
      .send({ title: "Do something" });
    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({ priority: "medium" }),
    );
  });
});
