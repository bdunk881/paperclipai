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
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
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
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        userId: "test-user",
        teamId: "team-1",
        agentId: "agent-1",
        executionId: "execution-1",
        status: "completed",
      })
    );
  });

  // HEL-143: budget_alerts surface
  describe("GET /budget-alerts", () => {
    it("returns the workspace's budget alerts ordered by the store contract", async () => {
      const alerts = [
        {
          id: "alert-2",
          teamId: "team-1",
          userId: "test-user",
          agentId: "agent-2",
          scope: "agent" as const,
          threshold: 0.8,
          budgetUsd: 100,
          spentUsd: 82,
          recordedAt: "2026-05-19T14:14:00.000Z",
        },
        {
          id: "alert-1",
          teamId: "team-1",
          userId: "test-user",
          scope: "team" as const,
          threshold: 0.5,
          budgetUsd: 500,
          spentUsd: 251,
          recordedAt: "2026-05-18T10:00:00.000Z",
        },
      ];
      const spy = jest.spyOn(controlPlaneStore, "listBudgetAlerts").mockResolvedValue(alerts);

      const response = await request(app).get("/api/control-plane/budget-alerts");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ alerts, total: 2 });
      expect(spy).toHaveBeenCalledWith("test-user", undefined);
    });

    it("forwards the teamId query param as a filter", async () => {
      const spy = jest.spyOn(controlPlaneStore, "listBudgetAlerts").mockResolvedValue([]);

      const response = await request(app)
        .get("/api/control-plane/budget-alerts")
        .query({ teamId: "team-zebra" });

      expect(response.status).toBe(200);
      expect(spy).toHaveBeenCalledWith("test-user", "team-zebra");
    });

    it("returns 500 with a stable shape when the store throws", async () => {
      jest
        .spyOn(controlPlaneStore, "listBudgetAlerts")
        .mockRejectedValue(new Error("pg connection refused"));

      const response = await request(app).get("/api/control-plane/budget-alerts");

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Failed to load budget alerts" });
    });

    it("returns an empty list (not 404) when the workspace has no alerts", async () => {
      jest.spyOn(controlPlaneStore, "listBudgetAlerts").mockResolvedValue([]);

      const response = await request(app).get("/api/control-plane/budget-alerts");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ alerts: [], total: 0 });
    });
  });
});
