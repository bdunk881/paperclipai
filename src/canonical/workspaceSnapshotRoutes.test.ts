import express from "express";
import request from "supertest";
import { createWorkspaceSnapshotRoutes } from "./workspaceSnapshotRoutes";
import * as snapshotService from "./workspaceSnapshotService";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { auth?: { sub: string }; workspace?: { id: string } }).auth = {
      sub: "user-1",
    };
    (req as express.Request & { workspace?: { id: string } }).workspace = { id: "ws-1" };
    next();
  });
  app.use("/api/workspace", createWorkspaceSnapshotRoutes());
  return app;
}

describe("GET /api/workspace/snapshot", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns home snapshot for surfaces=home", async () => {
    const payload = {
      agents: [],
      missions: [],
      approvals: [],
      runs: [],
      budgets: [],
      heartbeats: {},
      generatedAt: "2026-01-01T00:00:00.000Z",
    };
    jest.spyOn(snapshotService, "getCachedHomeSnapshot").mockResolvedValue(payload);

    const res = await request(buildApp()).get("/api/workspace/snapshot?surfaces=home");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(payload);
    expect(snapshotService.getCachedHomeSnapshot).toHaveBeenCalledWith("ws-1", "user-1");
  });

  it("rejects unknown surfaces", async () => {
    const res = await request(buildApp()).get("/api/workspace/snapshot?surfaces=unknown");
    expect(res.status).toBe(400);
  });
});
