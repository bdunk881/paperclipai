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

describe("GET /api/workflows/:workflowId/versions", () => {
  it("returns 401 when no authenticated user is present", async () => {
    const app = buildApp({ workspaceId: "11111111-1111-4111-8111-111111111111" });
    const res = await request(app).get(
      "/api/workflows/22222222-2222-4222-8222-222222222222/versions",
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when no workspace context is present", async () => {
    const app = buildApp({ sub: "user-1" });
    const res = await request(app).get(
      "/api/workflows/22222222-2222-4222-8222-222222222222/versions",
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when the workflow ID is malformed", async () => {
    const app = buildApp({
      sub: "user-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await request(app).get("/api/workflows/not-a-uuid/versions");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid workflow ID/);
  });
});

describe("GET /api/workflows/:workflowId/versions/:versionId", () => {
  const goodWorkflowId = "22222222-2222-4222-8222-222222222222";
  const goodVersionId = "33333333-3333-4333-8333-333333333333";

  it("returns 401 when no authenticated user is present", async () => {
    const app = buildApp({ workspaceId: "11111111-1111-4111-8111-111111111111" });
    const res = await request(app).get(
      `/api/workflows/${goodWorkflowId}/versions/${goodVersionId}`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when no workspace context is present", async () => {
    const app = buildApp({ sub: "user-1" });
    const res = await request(app).get(
      `/api/workflows/${goodWorkflowId}/versions/${goodVersionId}`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when the workflow ID is malformed", async () => {
    const app = buildApp({
      sub: "user-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await request(app).get(
      `/api/workflows/not-a-uuid/versions/${goodVersionId}`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid workflow ID/);
  });

  it("returns 400 when the version ID is malformed", async () => {
    const app = buildApp({
      sub: "user-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await request(app).get(
      `/api/workflows/${goodWorkflowId}/versions/not-a-uuid`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid version ID/);
  });
});

// ---------------------------------------------------------------------------
// HEL-241C — POST /api/workflows/:workflowId/presence
// ---------------------------------------------------------------------------

import { createPresenceStore } from "./presenceStore";

function buildPresenceApp(
  authOverrides: { sub?: string; workspaceId?: string } = {},
) {
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
  const store = createPresenceStore();
  app.use("/api/workflows", createWorkflowRoutes(stubPool, store));
  return { app, store };
}

describe("POST /api/workflows/:workflowId/presence", () => {
  const goodWorkflowId = "22222222-2222-4222-8222-222222222222";
  const workspaceId = "11111111-1111-4111-8111-111111111111";

  it("returns 401 when unauthed", async () => {
    const { app } = buildPresenceApp({ workspaceId });
    const res = await request(app).post(`/api/workflows/${goodWorkflowId}/presence`).send({});
    expect(res.status).toBe(401);
  });

  it("rejects malformed workflow ids", async () => {
    const { app } = buildPresenceApp({ sub: "user-1", workspaceId });
    const res = await request(app).post(`/api/workflows/not-a-uuid/presence`).send({});
    expect(res.status).toBe(400);
  });

  it("heartbeat returns the live peer list excluding the caller", async () => {
    const { app, store } = buildPresenceApp({ sub: "user-1", workspaceId });
    // Pre-seed a peer.
    store.upsert(goodWorkflowId, {
      userId: "user-2",
      name: "Other",
      color: "#000",
      selectedStepId: null,
      lastSeen: Date.now(),
    });
    const res = await request(app)
      .post(`/api/workflows/${goodWorkflowId}/presence`)
      .send({ name: "Bryan", selectedStepId: "step-a" });
    expect(res.status).toBe(200);
    expect(res.body.peers).toHaveLength(1);
    expect(res.body.peers[0].userId).toBe("user-2");
    // Caller's own state is recorded in the store, just not echoed back.
    const allPeers = store.peers(goodWorkflowId);
    expect(allPeers.map((p) => p.userId).sort()).toEqual(["user-1", "user-2"]);
    const self = allPeers.find((p) => p.userId === "user-1")!;
    expect(self.name).toBe("Bryan");
    expect(self.selectedStepId).toBe("step-a");
  });

  it("trims and truncates the display name to keep payloads bounded", async () => {
    const { app, store } = buildPresenceApp({ sub: "user-1", workspaceId });
    const longName = "  " + "a".repeat(200) + "  ";
    await request(app)
      .post(`/api/workflows/${goodWorkflowId}/presence`)
      .send({ name: longName });
    const self = store.peers(goodWorkflowId).find((p) => p.userId === "user-1")!;
    expect(self.name.length).toBe(80);
    expect(self.name.startsWith("a")).toBe(true);
  });

  it("falls back to 'Teammate' when no name is provided", async () => {
    const { app, store } = buildPresenceApp({ sub: "user-1", workspaceId });
    await request(app).post(`/api/workflows/${goodWorkflowId}/presence`).send({});
    const self = store.peers(goodWorkflowId).find((p) => p.userId === "user-1")!;
    expect(self.name).toBe("Teammate");
  });
});
