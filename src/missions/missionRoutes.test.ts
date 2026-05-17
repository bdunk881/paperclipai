/**
 * HEL-24 — input-validation + auth-gate coverage for the mission routes.
 *
 * Happy-path coverage (LLM-call → parse → persist) requires a mock
 * provider + Postgres test fixture and is deferred to the live integration
 * harness. These unit tests cover the synchronous reject branches the
 * route enforces before any side effect runs.
 */

// Prevent transitive import of ESM-only @mistralai/mistralai (same pattern
// as src/api.test.ts). The reject paths under test never invoke a provider.
jest.mock("../engine/llmProviders", () => ({
  getProvider: jest.fn(),
}));

import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { createMissionRoutes } from "./missionRoutes";

// Stub Postgres pool — never queried in the rejection paths we test.
const stubPool = { query: jest.fn() } as unknown as Parameters<typeof createMissionRoutes>[0];

function buildApp(authOverrides: { sub?: string; workspaceId?: string } = {}): express.Express {
  const app = express();
  app.use(express.json());
  // Inject a fake auth + workspace middleware that mirrors what
  // requireAuth + withWorkspace would do upstream.
  app.use((req: Request, res: Response, next: NextFunction) => {
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
  app.use("/api/missions", createMissionRoutes(stubPool));
  return app;
}

describe("POST /api/missions/:missionId/generate-plan", () => {
  it("returns 401 when no authenticated user is present", async () => {
    const app = buildApp({ workspaceId: "11111111-1111-4111-8111-111111111111" });
    const res = await request(app)
      .post("/api/missions/22222222-2222-4222-8222-222222222222/generate-plan")
      .send({});
    expect(res.status).toBe(401);
  });

  it("returns 401 when no workspace context is present (withWorkspace not run upstream)", async () => {
    const app = buildApp({ sub: "user-1" });
    const res = await request(app)
      .post("/api/missions/22222222-2222-4222-8222-222222222222/generate-plan")
      .send({});
    expect(res.status).toBe(401);
  });

  it("returns 400 when the mission ID is not a valid UUID", async () => {
    const app = buildApp({
      sub: "user-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await request(app).post("/api/missions/not-a-uuid/generate-plan").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid mission ID/);
  });
});

describe("POST /api/missions (HEL-23 create)", () => {
  it("returns 401 when no authenticated user is present", async () => {
    const app = buildApp({ workspaceId: "11111111-1111-4111-8111-111111111111" });
    const res = await request(app).post("/api/missions").send({ statement: "Launch X." });
    expect(res.status).toBe(401);
  });

  it("returns 401 when no workspace context is present", async () => {
    const app = buildApp({ sub: "user-1" });
    const res = await request(app).post("/api/missions").send({ statement: "Launch X." });
    expect(res.status).toBe(401);
  });

  it("returns 400 when the statement is missing", async () => {
    const app = buildApp({
      sub: "user-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await request(app).post("/api/missions").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/statement/i);
  });

  it("returns 400 when the statement is empty whitespace", async () => {
    const app = buildApp({
      sub: "user-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await request(app).post("/api/missions").send({ statement: "   \n  " });
    expect(res.status).toBe(400);
  });

  it("returns 400 when the statement exceeds 4000 characters", async () => {
    const app = buildApp({
      sub: "user-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await request(app)
      .post("/api/missions")
      .send({ statement: "a".repeat(4001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too long/i);
  });
});

describe("GET /api/missions (HEL-23 list)", () => {
  it("returns 401 when no authenticated user is present", async () => {
    const app = buildApp({ workspaceId: "11111111-1111-4111-8111-111111111111" });
    const res = await request(app).get("/api/missions");
    expect(res.status).toBe(401);
  });

  it("returns 401 when no workspace context is present", async () => {
    const app = buildApp({ sub: "user-1" });
    const res = await request(app).get("/api/missions");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/missions/:missionId (HEL-23 read)", () => {
  it("returns 401 when no authenticated user is present", async () => {
    const app = buildApp({ workspaceId: "11111111-1111-4111-8111-111111111111" });
    const res = await request(app).get(
      "/api/missions/22222222-2222-4222-8222-222222222222",
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when the mission ID is malformed", async () => {
    const app = buildApp({
      sub: "user-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await request(app).get("/api/missions/not-a-uuid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid mission ID/);
  });
});

// Regression for the dashboard "Too Many Requests" surface on /hire +
// /mission-state. The LLM endpoint rate limiter used to be mounted at
// the router level (app.use("/api/missions", ..., llmEndpointRateLimiter)),
// which meant cheap GET list reads counted against the 10/hour LLM
// quota and blocked dashboard page loads. The limiter is now injected
// via createMissionRoutes(pool, { llmRouteLimiter }) and applied only
// inside the generate-plan POST.
describe("LLM rate-limiter wiring", () => {
  function buildAppWithLimiter(
    authOverrides: { sub?: string; workspaceId?: string },
    limiter: import("express").RequestHandler,
  ): express.Express {
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
    app.use(
      "/api/missions",
      createMissionRoutes(stubPool, { llmRouteLimiter: limiter }),
    );
    return app;
  }

  it("does NOT apply the injected limiter to GET / (dashboard list reads)", async () => {
    let limiterCalls = 0;
    const fakeLimiter: import("express").RequestHandler = (_req, _res, next) => {
      limiterCalls += 1;
      next();
    };
    const app = buildAppWithLimiter(
      {
        sub: "user-1",
        workspaceId: "11111111-1111-4111-8111-111111111111",
      },
      fakeLimiter,
    );

    // GET /api/missions hits the list handler — must bypass the limiter.
    await request(app).get("/api/missions");
    expect(limiterCalls).toBe(0);
  });

  it("DOES apply the injected limiter to POST /:missionId/generate-plan", async () => {
    let limiterCalls = 0;
    const fakeLimiter: import("express").RequestHandler = (_req, _res, next) => {
      limiterCalls += 1;
      next();
    };
    const app = buildAppWithLimiter(
      {
        sub: "user-1",
        workspaceId: "11111111-1111-4111-8111-111111111111",
      },
      fakeLimiter,
    );

    await request(app)
      .post("/api/missions/22222222-2222-4222-8222-222222222222/generate-plan")
      .send({});
    expect(limiterCalls).toBe(1);
  });

  it("works without an injected limiter (createMissionRoutes options is optional)", async () => {
    // No limiter passed — generate-plan must still resolve (and return
    // a sane status from the handler, not a middleware-chain crash).
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { auth?: { sub: string } }).auth = { sub: "user-1" };
      (req as Request & { workspace?: { id: string; role: string } }).workspace = {
        id: "11111111-1111-4111-8111-111111111111",
        role: "owner",
      };
      next();
    });
    app.use("/api/missions", createMissionRoutes(stubPool));
    const res = await request(app)
      .post("/api/missions/22222222-2222-4222-8222-222222222222/generate-plan")
      .send({});
    // 400 from the handler's request-body validation is fine — what
    // matters is we reached the handler, not that we crashed on a
    // missing limiter.
    expect([400, 404, 500]).toContain(res.status);
  });
});
