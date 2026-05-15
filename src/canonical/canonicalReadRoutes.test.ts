/**
 * HEL-118 — auth + early-reject coverage for the canonical read-only routes.
 *
 * Each route gets a 401 when no authenticated user is present and a 401 when
 * the workspace resolver hasn't been mounted upstream. The step-results route
 * also tests UUID validation. Happy-path DB coverage is deferred to the
 * integration harness with a live Postgres fixture.
 */

import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import {
  createBudgetsRoutes,
  createConnectorConnectionsRoutes,
  createEntitlementsRoutes,
  createOrgGraphRoutes,
  createStepResultsRoutes,
  createWakeEventsRoutes,
} from "./canonicalReadRoutes";

const stubPool = { query: jest.fn() } as unknown as Parameters<typeof createOrgGraphRoutes>[0];

function buildApp(
  mountPath: string,
  router: ReturnType<typeof express.Router>,
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
  app.use(mountPath, router);
  return app;
}

const WS_UUID = "11111111-1111-4111-8111-111111111111";

describe.each([
  ["/api/org-graph", () => createOrgGraphRoutes(stubPool), "/"],
  ["/api/budgets", () => createBudgetsRoutes(stubPool), "/"],
  ["/api/entitlements", () => createEntitlementsRoutes(stubPool), "/"],
  ["/api/wake-events", () => createWakeEventsRoutes(stubPool), "/"],
  ["/api/connector-connections", () => createConnectorConnectionsRoutes(stubPool), "/"],
])("HEL-118 — %s reject paths", (mount, factory, subPath) => {
  it("returns 401 when no authenticated user is present", async () => {
    const app = buildApp(mount, factory(), { workspaceId: WS_UUID });
    const res = await request(app).get(`${mount}${subPath === "/" ? "" : subPath}`);
    expect(res.status).toBe(401);
  });

  it("returns 401 when no workspace context is present", async () => {
    const app = buildApp(mount, factory(), { sub: "user-1" });
    const res = await request(app).get(`${mount}${subPath === "/" ? "" : subPath}`);
    expect(res.status).toBe(401);
  });
});

describe("HEL-118 — /api/step-results/:runId (param validation + rejects)", () => {
  const router = createStepResultsRoutes(stubPool);

  it("returns 401 when no authenticated user is present", async () => {
    const app = buildApp("/api/step-results", router, { workspaceId: WS_UUID });
    const res = await request(app).get(
      "/api/step-results/22222222-2222-4222-8222-222222222222",
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when no workspace context is present", async () => {
    const app = buildApp("/api/step-results", router, { sub: "user-1" });
    const res = await request(app).get(
      "/api/step-results/22222222-2222-4222-8222-222222222222",
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for a non-UUID run id", async () => {
    const app = buildApp("/api/step-results", router, {
      sub: "user-1",
      workspaceId: WS_UUID,
    });
    const res = await request(app).get("/api/step-results/not-a-uuid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid run ID/);
  });
});
