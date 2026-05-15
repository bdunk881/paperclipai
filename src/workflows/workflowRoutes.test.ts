/**
 * HEL-27 — auth + validation reject-path coverage for the canonical
 * workflows + workflow_versions routes. Happy-path persistence (live
 * INSERTs into workflows / workflow_versions with RLS) is covered by
 * the rls.integration.test.ts suite which already inserts test rows
 * into those tables.
 */

import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { createWorkflowRoutes } from "./workflowRoutes";

// Stub Postgres pool — never queried in the reject paths we test here.
const stubPool = { query: jest.fn() } as unknown as Parameters<typeof createWorkflowRoutes>[0];

function buildApp(authOverrides: { sub?: string; workspaceId?: string } = {}): express.Express {
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
  app.use("/api/workflows", createWorkflowRoutes(stubPool));
  return app;
}

describe("POST /api/workflows", () => {
  it("returns 401 when no authenticated user is present", async () => {
    const app = buildApp({ workspaceId: "11111111-1111-4111-8111-111111111111" });
    const res = await request(app).post("/api/workflows").send({ name: "Lead enrichment" });
    expect(res.status).toBe(401);
  });

  it("returns 401 when no workspace context is present", async () => {
    const app = buildApp({ sub: "user-1" });
    const res = await request(app).post("/api/workflows").send({ name: "Lead enrichment" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when name is missing", async () => {
    const app = buildApp({
      sub: "user-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await request(app).post("/api/workflows").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name is required/i);
  });

  it("returns 400 when name is whitespace", async () => {
    const app = buildApp({
      sub: "user-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await request(app).post("/api/workflows").send({ name: "   " });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/workflows/:workflowId/versions", () => {
  it("returns 401 when no authenticated user is present", async () => {
    const app = buildApp({ workspaceId: "11111111-1111-4111-8111-111111111111" });
    const res = await request(app)
      .post("/api/workflows/22222222-2222-4222-8222-222222222222/versions")
      .send({ dag: {} });
    expect(res.status).toBe(401);
  });

  it("returns 400 when the workflow ID is malformed", async () => {
    const app = buildApp({
      sub: "user-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await request(app).post("/api/workflows/not-a-uuid/versions").send({ dag: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid workflow ID/);
  });
});

describe("GET /api/workflows/:workflowId", () => {
  it("returns 400 when the workflow ID is malformed", async () => {
    const app = buildApp({
      sub: "user-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await request(app).get("/api/workflows/not-a-uuid");
    expect(res.status).toBe(400);
  });
});
