import express from "express";
import request from "supertest";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import { createWorkspaceRoutes } from "./workspaceRoutes";

function buildApp(queryImpl: jest.Mock, connectImpl?: jest.Mock) {
  const app = express();
  app.use(express.json());
  app.use((req: AuthenticatedRequest, _res, next) => {
    req.auth = { sub: "user-123", email: "test@example.com" };
    next();
  });
  app.use(
    "/api/workspaces",
    createWorkspaceRoutes({
      query: queryImpl,
      connect: connectImpl,
    } as never)
  );
  return app;
}

describe("workspaceRoutes", () => {
  it("lists member workspaces with derived slugs", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        { id: "22222222-2222-4222-8222-222222222222", name: "Acme AI" },
        { id: "33333333-3333-4333-8333-333333333333", name: "Ops / North America" },
      ],
    });
    const app = buildApp(query);

    const res = await request(app)
      .get("/api/workspaces")
      .set("Authorization", "Bearer user-123");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Acme AI",
        slug: "acme-ai",
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Ops / North America",
        slug: "ops-north-america",
      },
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM workspaces"), ["user-123"]);
  });

  it("auto-provisions a default workspace when the user has zero (HEL-83 follow-on)", async () => {
    const newWorkspaceId = "55555555-5555-4555-8555-555555555555";
    // 1st list query: 0 rows → triggers provision
    // 2nd list query (after provision): 1 row with the newly-created workspace
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: newWorkspaceId, name: "My Workspace" }] });

    // provisionDefaultWorkspace uses pool.connect() internally
    const provisionClient = {
      query: jest
        .fn()
        // BEGIN
        .mockResolvedValueOnce(undefined)
        // pg_advisory_xact_lock
        .mockResolvedValueOnce(undefined)
        // re-check inside lock — 0 rows
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // INSERT workspaces RETURNING id
        .mockResolvedValueOnce({ rows: [{ id: newWorkspaceId }], rowCount: 1 })
        // INSERT workspace_members
        .mockResolvedValueOnce(undefined)
        // COMMIT
        .mockResolvedValueOnce(undefined),
      release: jest.fn(),
    };
    const connect = jest.fn().mockResolvedValue(provisionClient);
    const app = buildApp(query, connect);

    const res = await request(app)
      .get("/api/workspaces")
      .set("Authorization", "Bearer user-123");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: newWorkspaceId,
        name: "My Workspace",
        slug: "my-workspace",
      },
    ]);
    // Two list queries (pre + post provision) + the provision INSERTs through the client.
    expect(query).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(provisionClient.release).toHaveBeenCalledTimes(1);
  });

  it("creates a workspace and returns a derived slug", async () => {
    const query = jest.fn();
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          rows: [{ id: "22222222-2222-4222-8222-222222222222", name: "Acme AI" }],
        })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined),
      release: jest.fn(),
    };
    const connect = jest.fn().mockResolvedValue(client);
    const app = buildApp(query, connect);

    const res = await request(app)
      .post("/api/workspaces")
      .set("Authorization", "Bearer user-123")
      .send({ name: "Acme AI" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: "22222222-2222-4222-8222-222222222222",
      name: "Acme AI",
      slug: "acme-ai",
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO workspaces"),
      ["Acme AI", "user-123"]
    );
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("INSERT INTO workspace_members"),
      ["22222222-2222-4222-8222-222222222222", "user-123"]
    );
    expect(client.query).toHaveBeenNthCalledWith(4, "COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
