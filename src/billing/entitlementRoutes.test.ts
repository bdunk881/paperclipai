import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { createEntitlementRoutes } from "./entitlementRoutes";

const stubPool = { query: jest.fn() } as unknown as Parameters<typeof createEntitlementRoutes>[0];

function buildApp(overrides: { sub?: string; workspaceId?: string } = {}): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (overrides.sub) {
      (req as Request & { auth?: { sub: string } }).auth = { sub: overrides.sub };
    }
    if (overrides.workspaceId) {
      (req as Request & { workspace?: { id: string; role: string } }).workspace = {
        id: overrides.workspaceId,
        role: "admin",
      };
    }
    next();
  });
  app.use("/api/entitlements", createEntitlementRoutes(stubPool));
  return app;
}

describe("GET /api/entitlements", () => {
  it("returns 401 when no authenticated user is present", async () => {
    const app = buildApp({ workspaceId: "11111111-1111-4111-8111-111111111111" });
    const res = await request(app).get("/api/entitlements");
    expect(res.status).toBe(401);
  });

  it("returns 401 when no workspace context is present", async () => {
    const app = buildApp({ sub: "user-1" });
    const res = await request(app).get("/api/entitlements");
    expect(res.status).toBe(401);
  });
});
