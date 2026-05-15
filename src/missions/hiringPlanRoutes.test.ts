/**
 * HEL-25 — auth + validation + early-reject coverage for the hiring-plan
 * confirm route.
 *
 * Happy-path coverage (transaction → agents insert → org_edges insert →
 * activity events) requires a live Postgres test fixture and is deferred
 * to the integration harness. These unit tests cover the synchronous
 * reject branches the route enforces before any side effect runs.
 */

// Prevent transitive import of ESM-only @mistralai/mistralai. The reject
// paths under test never decrypt an LLM config.
jest.mock("../engine/llmProviders", () => ({
  getProvider: jest.fn(),
}));

import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { createHiringPlanRoutes } from "./hiringPlanRoutes";

// Stub Postgres pool — never queried in the rejection paths we test.
const stubPool = { query: jest.fn() } as unknown as Parameters<typeof createHiringPlanRoutes>[0];

function buildApp(authOverrides: { sub?: string; workspaceId?: string } = {}): express.Express {
  const app = express();
  app.use(express.json());
  // Inject a fake auth + workspace middleware that mirrors what
  // requireAuth + withWorkspace would do upstream.
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
  app.use("/api/hiring-plans", createHiringPlanRoutes(stubPool));
  return app;
}

describe("POST /api/hiring-plans/:hiringPlanId/confirm", () => {
  it("returns 401 when no authenticated user is present", async () => {
    const app = buildApp({ workspaceId: "11111111-1111-4111-8111-111111111111" });
    const res = await request(app)
      .post("/api/hiring-plans/22222222-2222-4222-8222-222222222222/confirm")
      .send({});
    expect(res.status).toBe(401);
  });

  it("returns 401 when no workspace context is present (withWorkspace not run upstream)", async () => {
    const app = buildApp({ sub: "user-1" });
    const res = await request(app)
      .post("/api/hiring-plans/22222222-2222-4222-8222-222222222222/confirm")
      .send({});
    expect(res.status).toBe(401);
  });

  it("returns 400 when the hiring plan ID is not a valid UUID", async () => {
    const app = buildApp({
      sub: "user-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await request(app).post("/api/hiring-plans/not-a-uuid/confirm").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid hiring plan ID/);
  });
});
