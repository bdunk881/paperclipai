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

// Stub profile-store helpers — the FK-precheck regression test asserts
// against the spy, and the rejection-path tests don't care if the helper
// runs or not.
jest.mock("../user/profileStore", () => ({
  ensureUserProfileExists: jest.fn().mockResolvedValue(undefined),
}));

import { ensureUserProfileExists as mockedEnsureUserProfileExists } from "../user/profileStore";

import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { createMissionRoutes, teamAssemblyRequestFromMission } from "./missionRoutes";
import { buildTeamAssemblyPrompt } from "../goals/teamAssembly";

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

  it("returns 400 when the statement exceeds 50000 characters", async () => {
    const app = buildApp({
      sub: "user-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await request(app)
      .post("/api/missions")
      .send({ statement: "a".repeat(50_001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too long/i);
  });

  // Regression: OAuth-only users (no Profile Settings save yet) used to
  // hit a FK violation on missions.created_by_user_id -> user_profiles
  // and saw a generic "Failed to create mission" banner on /hire. The
  // POST handler now auto-provisions the user_profiles row before the
  // INSERT, so the FK is always satisfied.
  it("auto-provisions the user profile before the missions INSERT", async () => {
    (mockedEnsureUserProfileExists as jest.Mock).mockClear();
    const app = buildApp({
      sub: "oauth-user-with-no-profile",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    // The downstream ensureDefaultCompany call will fail against the
    // stub pool (pool.connect is not implemented), but the profile
    // pre-check must still have fired first.
    await request(app)
      .post("/api/missions")
      .send({ statement: "Launch X." });
    expect(mockedEnsureUserProfileExists).toHaveBeenCalledTimes(1);
    expect(mockedEnsureUserProfileExists).toHaveBeenCalledWith(
      "oauth-user-with-no-profile",
    );
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

describe("PATCH /api/missions/:missionId (HEL-192 — edit draft brief)", () => {
  it("returns 401 when no authenticated user is present", async () => {
    const app = buildApp({ workspaceId: "11111111-1111-4111-8111-111111111111" });
    const res = await request(app)
      .patch("/api/missions/22222222-2222-4222-8222-222222222222")
      .send({ statement: "next" });
    expect(res.status).toBe(401);
  });

  it("returns 401 when no workspace context is present", async () => {
    const app = buildApp({ sub: "user-1" });
    const res = await request(app)
      .patch("/api/missions/22222222-2222-4222-8222-222222222222")
      .send({ statement: "next" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when the mission ID is malformed", async () => {
    const app = buildApp({
      sub: "user-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await request(app)
      .patch("/api/missions/not-a-uuid")
      .send({ statement: "next" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid mission ID/);
  });

  it("returns 400 when neither statement nor metadata is provided", async () => {
    const app = buildApp({
      sub: "user-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await request(app)
      .patch("/api/missions/22222222-2222-4222-8222-222222222222")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/At least one of/);
  });

  it("returns 400 when statement is not a string", async () => {
    const app = buildApp({
      sub: "user-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await request(app)
      .patch("/api/missions/22222222-2222-4222-8222-222222222222")
      .send({ statement: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/string/);
  });

  it("returns 400 when statement is empty after trim", async () => {
    const app = buildApp({
      sub: "user-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await request(app)
      .patch("/api/missions/22222222-2222-4222-8222-222222222222")
      .send({ statement: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });
});

describe("DELETE /api/missions/:missionId (Wave 1 — discard draft)", () => {
  it("returns 401 when no authenticated user is present", async () => {
    const app = buildApp({ workspaceId: "11111111-1111-4111-8111-111111111111" });
    const res = await request(app).delete(
      "/api/missions/22222222-2222-4222-8222-222222222222",
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when no workspace context is present", async () => {
    const app = buildApp({ sub: "user-1" });
    const res = await request(app).delete(
      "/api/missions/22222222-2222-4222-8222-222222222222",
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when the mission ID is malformed", async () => {
    const app = buildApp({
      sub: "user-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await request(app).delete("/api/missions/not-a-uuid");
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

describe("teamAssemblyRequestFromMission", () => {
  const baseMission = {
    id: "33333333-3333-4333-8333-333333333333",
    company_id: "44444444-4444-4444-8444-444444444444",
    statement: "Land 5 OEM design partners for our welding-robot scheduler.",
    workspace_id: "11111111-1111-4111-8111-111111111111",
    company_name: "WeldOps",
    company_description: "Cloud scheduler for industrial welding robots.",
    metadata: {},
  };

  it("maps every structured intake field into the normalized goal document", () => {
    const request = teamAssemblyRequestFromMission({
      ...baseMission,
      metadata: {
        industry: "Industrial robotics",
        targetCustomer: "OEM purchasing managers in the US",
        successMetric: "5 signed design partners by Q4",
        runway: "$250k over 6 months",
      },
    });

    expect(request.companyName).toBe("WeldOps");
    expect(request.normalizedGoalDocument.goal).toBe(baseMission.statement);
    expect(request.normalizedGoalDocument.targetCustomer).toBe(
      "OEM purchasing managers in the US",
    );
    expect(request.normalizedGoalDocument.successMetrics).toEqual([
      "5 signed design partners by Q4",
    ]);
    expect(request.normalizedGoalDocument.budget).toBe("$250k over 6 months");
    expect(request.normalizedGoalDocument.constraints).toEqual([
      "Industry: Industrial robotics",
    ]);
    expect(request.normalizedGoalDocument.importedContextSummary).toContain(
      "Company: WeldOps",
    );
    expect(request.normalizedGoalDocument.importedContextSummary).toContain(
      "About the company: Cloud scheduler for industrial welding robots.",
    );
    expect(request.normalizedGoalDocument.importedContextSummary).toContain(
      "Industry: Industrial robotics",
    );
  });

  it("does not inject the default role library into mission-generated prompts", () => {
    const request = teamAssemblyRequestFromMission(baseMission);

    expect(request.roleLibrary).toEqual([]);
  });

  it("leaves optional fields null/empty when the operator skipped them", () => {
    const request = teamAssemblyRequestFromMission({
      ...baseMission,
      company_description: null,
      metadata: null,
    });

    expect(request.normalizedGoalDocument.targetCustomer).toBeNull();
    expect(request.normalizedGoalDocument.successMetrics).toEqual([]);
    expect(request.normalizedGoalDocument.budget).toBeNull();
    expect(request.normalizedGoalDocument.constraints).toEqual([]);
    expect(request.normalizedGoalDocument.importedContextSummary).toBe(
      "Company: WeldOps",
    );
  });

  it("maps individual metadata fields correctly", () => {
    expect(
      teamAssemblyRequestFromMission({
        ...baseMission,
        metadata: { targetCustomer: "OEM purchasing managers in the US" },
      }).normalizedGoalDocument.targetCustomer,
    ).toBe("OEM purchasing managers in the US");

    expect(
      teamAssemblyRequestFromMission({
        ...baseMission,
        metadata: { successMetric: "200 demos by Q4" },
      }).normalizedGoalDocument.successMetrics,
    ).toEqual(["200 demos by Q4"]);

    expect(
      teamAssemblyRequestFromMission({
        ...baseMission,
        metadata: { runway: "$250k over 6 months" },
      }).normalizedGoalDocument.budget,
    ).toBe("$250k over 6 months");
  });

  it("the prompt the LLM receives embeds the user-supplied context", () => {
    const request = teamAssemblyRequestFromMission({
      ...baseMission,
      metadata: {
        industry: "Industrial robotics",
        targetCustomer: "OEM purchasing managers in the US",
        successMetric: "5 signed design partners by Q4",
        runway: "$250k over 6 months",
      },
    });
    const prompt = buildTeamAssemblyPrompt(request);

    expect(prompt).toContain("Industrial robotics");
    expect(prompt).toContain("OEM purchasing managers in the US");
    expect(prompt).toContain("5 signed design partners by Q4");
    expect(prompt).toContain("$250k over 6 months");
    expect(prompt).toContain("Cloud scheduler for industrial welding robots.");
    expect(prompt).toContain(baseMission.statement);
    expect(prompt).not.toContain("Own strategy, resource allocation");
  });

  // HEL-211 — owner-defined free-form context pills serialise into the
  // team-assembly prompt as `${label}: ${value}` after the canonical
  // fields. The prompt builder receives them via importedContextSummary
  // so they sit beside the structured prompts (industry, runway, etc.).
  it("serialises owner-defined customContext entries into the prompt", () => {
    const request = teamAssemblyRequestFromMission({
      ...baseMission,
      metadata: {
        industry: "Healthtech",
        customContext: [
          { label: "Compliance", value: "HIPAA + SOC 2 required" },
          { label: "Geography", value: "US only for v1" },
        ],
      },
    });

    expect(request.normalizedGoalDocument.importedContextSummary).toContain(
      "Compliance: HIPAA + SOC 2 required",
    );
    expect(request.normalizedGoalDocument.importedContextSummary).toContain(
      "Geography: US only for v1",
    );

    const prompt = buildTeamAssemblyPrompt(request);
    expect(prompt).toContain("Compliance: HIPAA + SOC 2 required");
    expect(prompt).toContain("Geography: US only for v1");
  });
});
