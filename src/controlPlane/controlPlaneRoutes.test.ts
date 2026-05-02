import express from "express";
import request from "supertest";

import controlPlaneRoutes from "./controlPlaneRoutes";
import { controlPlaneStore } from "./controlPlaneStore";

jest.mock("../auditing/controlPlaneAudit", () => ({
  recordControlPlaneAudit: jest.fn().mockResolvedValue(undefined),
  recordControlPlaneAuditBatch: jest.fn().mockResolvedValue(undefined),
}));

describe("controlPlaneRoutes", () => {
  const app = express();

  beforeAll(() => {
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as express.Request & { auth?: { sub: string }; workspaceId?: string }).auth = { sub: "test-user" };
      (req as express.Request & { workspaceId?: string }).workspaceId =
        "11111111-1111-4111-8111-111111111111";
      next();
    });
    app.use("/api/control-plane", controlPlaneRoutes);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("passes resolved workspace context to heartbeat writes", async () => {
    const recordHeartbeat = jest.spyOn(controlPlaneStore, "recordHeartbeat").mockResolvedValue({
      id: "heartbeat-1",
      userId: "test-user",
      teamId: "team-1",
      agentId: "agent-1",
      executionId: "execution-1",
      status: "completed",
      summary: "Heartbeat succeeded after restart",
      costUsd: undefined,
      createdTaskIds: [],
      startedAt: "2026-05-02T00:00:00.000Z",
      completedAt: "2026-05-02T00:00:01.000Z",
    });

    const response = await request(app)
      .post("/api/control-plane/heartbeats")
      .set("X-Paperclip-Run-Id", "run-heartbeat-workspace")
      .send({
        teamId: "team-1",
        agentId: "agent-1",
        executionId: "execution-1",
        status: "completed",
        summary: "Heartbeat succeeded after restart",
      });

    expect(response.status).toBe(201);
    expect(recordHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        userId: "test-user",
        teamId: "team-1",
        agentId: "agent-1",
        executionId: "execution-1",
        status: "completed",
      })
    );
  });
});
