/**
 * HEL-491: mission-assignment replay re-dispatches a real agent-prompt job.
 */

jest.mock("../tickets/ticketStore", () => ({ ticketStore: { get: jest.fn() } }));
jest.mock("../queue/queues", () => ({ getAgentPromptQueue: jest.fn() }));

import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import replayRoutes from "./missionAssignmentReplayRoutes";
import { ticketStore } from "../tickets/ticketStore";
import { getAgentPromptQueue } from "../queue/queues";

const mockGet = ticketStore.get as jest.MockedFunction<typeof ticketStore.get>;
const mockGetQueue = getAgentPromptQueue as jest.MockedFunction<typeof getAgentPromptQueue>;

const AGENT_ID = "11111111-1111-4111-8111-111111111111";

function buildApp(opts: { userId?: string; workspaceId?: string } = { userId: "user-1", workspaceId: "ws-1" }) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const r = req as Request & { auth?: { sub: string }; workspaceId?: string };
    if (opts.userId) r.auth = { sub: opts.userId };
    if (opts.workspaceId) r.workspaceId = opts.workspaceId;
    next();
  });
  app.use("/api/mission-assignments", replayRoutes);
  return app;
}

function aggregateWithAgent(agentId = AGENT_ID) {
  return {
    ticket: {
      id: "tkt-1",
      workspaceId: "ws-1",
      description: "Do the thing",
      assignees: [{ type: "agent", id: agentId, role: "primary" }],
    },
    updates: [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /api/mission-assignments/:id/replay (HEL-491)", () => {
  it("re-dispatches a real agent-prompt job and returns the job id", async () => {
    mockGet.mockResolvedValue(aggregateWithAgent() as never);
    const add = jest.fn().mockResolvedValue({ id: "job-xyz" });
    mockGetQueue.mockReturnValue({ add } as never);

    const res = await request(buildApp()).post("/api/mission-assignments/tkt-1/replay").send({});

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      assignmentId: "tkt-1",
      jobId: "job-xyz",
      agentId: AGENT_ID,
      status: "queued",
      queued: true,
    });
    expect(add).toHaveBeenCalledWith(
      "manual",
      expect.objectContaining({
        workspaceId: "ws-1",
        userId: "user-1",
        agentId: AGENT_ID,
        prompt: "Do the thing",
        sourceTicketId: "tkt-1",
        triggerKind: "manual",
        idempotencyKey: expect.stringMatching(/^replay:tkt-1:/),
      }),
      expect.objectContaining({ jobId: expect.any(String) }),
    );
    // Workspace-scoped lookup.
    expect(mockGet).toHaveBeenCalledWith("tkt-1", { workspaceId: "ws-1", userId: "user-1" });
  });

  it("404s when the assignment does not exist", async () => {
    mockGet.mockResolvedValue(undefined);
    const res = await request(buildApp()).post("/api/mission-assignments/missing/replay").send({});
    expect(res.status).toBe(404);
  });

  it("409s when the assignment has no agent assignee", async () => {
    mockGet.mockResolvedValue({
      ticket: {
        id: "tkt-1",
        workspaceId: "ws-1",
        description: "x",
        assignees: [{ type: "user", id: "user-9", role: "primary" }],
      },
      updates: [],
    } as never);
    const res = await request(buildApp()).post("/api/mission-assignments/tkt-1/replay").send({});
    expect(res.status).toBe(409);
  });

  it("503s when the agent-prompt queue is not configured", async () => {
    mockGet.mockResolvedValue(aggregateWithAgent() as never);
    mockGetQueue.mockReturnValue(null);
    const res = await request(buildApp()).post("/api/mission-assignments/tkt-1/replay").send({});
    expect(res.status).toBe(503);
  });

  it("401s without an authenticated workspace user", async () => {
    const res = await request(buildApp({ workspaceId: "ws-1" }))
      .post("/api/mission-assignments/tkt-1/replay")
      .send({});
    expect(res.status).toBe(401);
  });
});
