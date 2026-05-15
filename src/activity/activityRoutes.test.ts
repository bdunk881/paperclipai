/**
 * HEL-29 — auth + validation reject-path coverage for the activity feed
 * route. Happy-path (live SELECT against `activity_events` with RLS) is
 * covered by the existing rls.integration.test.ts suite which already
 * inserts test rows into activity_events.
 */

import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { createActivityRoutes } from "./activityRoutes";

// Stub Postgres pool — never queried in the rejection paths we test.
const stubPool = { query: jest.fn() } as unknown as Parameters<typeof createActivityRoutes>[0];

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
  app.use("/api/activity-events", createActivityRoutes(stubPool));
  return app;
}

describe("GET /api/activity-events", () => {
  it("returns 401 when no authenticated user is present", async () => {
    const app = buildApp({ workspaceId: "11111111-1111-4111-8111-111111111111" });
    const res = await request(app).get("/api/activity-events");
    expect(res.status).toBe(401);
  });

  it("returns 401 when no workspace context is present (withWorkspace not run upstream)", async () => {
    const app = buildApp({ sub: "user-1" });
    const res = await request(app).get("/api/activity-events");
    expect(res.status).toBe(401);
  });
});
