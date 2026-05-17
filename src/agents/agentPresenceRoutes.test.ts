/**
 * Coverage for the agent presence routes (Wave 2a). The underlying
 * Redis layer is mocked at the agentPresence module level so these
 * tests stay fast.
 */

jest.mock("./agentPresence", () => ({
  setAgentPresence: jest.fn(),
  getAgentPresence: jest.fn(),
  listWorkspaceAgentPresence: jest.fn(),
}));

import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { createAgentPresenceRoutes } from "./agentPresenceRoutes";
import {
  getAgentPresence,
  listWorkspaceAgentPresence,
  setAgentPresence,
} from "./agentPresence";

const mockedSet = setAgentPresence as jest.Mock;
const mockedGet = getAgentPresence as jest.Mock;
const mockedList = listWorkspaceAgentPresence as jest.Mock;

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
  app.use("/api/agents", createAgentPresenceRoutes());
  return app;
}

beforeEach(() => {
  mockedSet.mockReset();
  mockedGet.mockReset();
  mockedList.mockReset();
});

const WS = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";

describe("GET /api/agents/presence", () => {
  it("returns 401 with no auth", async () => {
    const res = await request(buildApp({ workspaceId: WS })).get("/api/agents/presence");
    expect(res.status).toBe(401);
  });

  it("returns 401 with no workspace", async () => {
    const res = await request(buildApp({ sub: "user-1" })).get("/api/agents/presence");
    expect(res.status).toBe(401);
  });

  it("returns the live presence list for the workspace", async () => {
    mockedList.mockResolvedValueOnce([
      { agentId: AGENT, workspaceId: WS, state: "working", currentTask: "x", since: "a", updatedAt: "b" },
    ]);
    const res = await request(buildApp({ sub: "user-1", workspaceId: WS })).get(
      "/api/agents/presence",
    );
    expect(res.status).toBe(200);
    expect(res.body.agents).toHaveLength(1);
    expect(mockedList).toHaveBeenCalledWith(WS);
  });
});

describe("GET /api/agents/:agentId/presence", () => {
  it("returns 400 on a malformed agent ID", async () => {
    const res = await request(buildApp({ sub: "user-1", workspaceId: WS })).get(
      "/api/agents/not-a-uuid/presence",
    );
    expect(res.status).toBe(400);
  });

  it("returns presence:null when the TTL has lapsed", async () => {
    mockedGet.mockResolvedValueOnce(null);
    const res = await request(buildApp({ sub: "user-1", workspaceId: WS })).get(
      `/api/agents/${AGENT}/presence`,
    );
    expect(res.status).toBe(200);
    expect(res.body.presence).toBeNull();
  });

  it("returns the presence object when present", async () => {
    mockedGet.mockResolvedValueOnce({
      agentId: AGENT,
      workspaceId: WS,
      state: "working",
      currentTask: "x",
      since: "a",
      updatedAt: "b",
    });
    const res = await request(buildApp({ sub: "user-1", workspaceId: WS })).get(
      `/api/agents/${AGENT}/presence`,
    );
    expect(res.status).toBe(200);
    expect(res.body.presence?.state).toBe("working");
  });
});

describe("POST /api/agents/:agentId/presence", () => {
  it("returns 400 when state is missing or invalid", async () => {
    const res1 = await request(buildApp({ sub: "user-1", workspaceId: WS }))
      .post(`/api/agents/${AGENT}/presence`)
      .send({});
    expect(res1.status).toBe(400);

    const res2 = await request(buildApp({ sub: "user-1", workspaceId: WS }))
      .post(`/api/agents/${AGENT}/presence`)
      .send({ state: "bogus" });
    expect(res2.status).toBe(400);
  });

  it("writes presence with state + optional currentTask", async () => {
    mockedSet.mockResolvedValueOnce({
      agentId: AGENT,
      workspaceId: WS,
      state: "working",
      currentTask: "x",
      since: "a",
      updatedAt: "b",
    });
    const res = await request(buildApp({ sub: "user-1", workspaceId: WS }))
      .post(`/api/agents/${AGENT}/presence`)
      .send({ state: "working", currentTask: "x" });
    expect(res.status).toBe(200);
    expect(mockedSet).toHaveBeenCalledWith({
      workspaceId: WS,
      agentId: AGENT,
      state: "working",
      currentTask: "x",
    });
  });
});
