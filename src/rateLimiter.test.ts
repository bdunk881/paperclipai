/**
 * Tests for rate-limiting and authentication gate behaviour.
 *
 * Covers:
 *  - IP-level rate limiter (ipLimiter) headers on public routes
 *  - Per-user rate limiter (apiKeyLimiter) headers on authenticated routes
 *  - 401 returned when no Bearer token is present (auth gate)
 *  - 429 returned when the per-user limit is exhausted (limit enforcement)
 */

// ── Mocks must be hoisted before any imports ─────────────────────────────────

// Prevent transitive import of ESM-only packages
jest.mock("./engine/llmProviders", () => ({
  getProvider: jest.fn(),
}));

// Default auth mock: valid authenticated user
const mockAuthSub = "test-user-rate-limit";
const mockRequireAuth = jest.fn(
  (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.auth = { sub: mockAuthSub, email: "ratelimit@example.com" };
    next();
  }
);

jest.mock("./auth/authMiddleware", () => ({
  get requireAuth() {
    return mockRequireAuth;
  },
}));

// Expose rate-limit internals so we can override max in certain tests
let ipLimiterMax = 1000;
let apiKeyLimiterMax = 100;

jest.mock("express-rate-limit", () => {
  const actual = jest.requireActual<typeof import("express-rate-limit")>("express-rate-limit");
  return {
    __esModule: true,
    default: (options: Record<string, unknown>) => {
      // Use tightened max values injected by tests when present
      const max =
        options.keyGenerator &&
        String(options.keyGenerator).includes("req.auth")
          ? apiKeyLimiterMax
          : ipLimiterMax;
      return actual.default({ ...options, max });
    },
  };
});

import request from "supertest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Re-import app after each test so rate-limit state is fresh. */
function freshApp() {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("./app").default;
}

// ---------------------------------------------------------------------------
// IP rate-limiter — public route (GET /api/templates)
// ---------------------------------------------------------------------------

describe("IP rate-limiter (ipLimiter)", () => {
  it("includes RateLimit-Limit header on public routes", async () => {
    const app = freshApp();
    const res = await request(app).get("/api/templates");
    expect(res.status).toBe(200);
    // express-rate-limit sets RateLimit-Limit when standardHeaders: true
    expect(res.headers["ratelimit-limit"]).toBeDefined();
  });

  it("includes RateLimit-Remaining header on public routes", async () => {
    const app = freshApp();
    const res = await request(app).get("/api/templates");
    expect(res.headers["ratelimit-remaining"]).toBeDefined();
    const remaining = parseInt(res.headers["ratelimit-remaining"] as string, 10);
    expect(remaining).toBeGreaterThanOrEqual(0);
  });

  it("returns 429 and error message when IP limit is exceeded", async () => {
    ipLimiterMax = 1; // allow only 1 request
    apiKeyLimiterMax = 100;
    const app = freshApp();

    // First request should pass
    const first = await request(app).get("/api/templates");
    expect(first.status).toBe(200);

    // Second request from the same IP should be rate-limited
    const second = await request(app).get("/api/templates");
    expect(second.status).toBe(429);
    expect(second.body.error).toMatch(/too many requests/i);

    ipLimiterMax = 1000; // reset
  });
});

// ---------------------------------------------------------------------------
// Authentication gate — routes protected by requireAuth
// ---------------------------------------------------------------------------

describe("Authentication gate", () => {
  beforeEach(() => {
    // Restore the default passing auth mock
    mockRequireAuth.mockImplementation(
      (req: Record<string, unknown>, _res: unknown, next: () => void) => {
        req.auth = { sub: mockAuthSub, email: "ratelimit@example.com" };
        next();
      }
    );
  });

  it("returns 401 when no Bearer token is provided to POST /api/runs", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockRequireAuth.mockImplementation((_req: any, res: any, _next: any) => {
      res.status(401).json({ error: "Unauthorized" });
    });
    const app = freshApp();
    const res = await request(app).post("/api/runs").send({ templateId: "any" });
    expect(res.status).toBe(401);
  });

  it("returns 401 when no Bearer token is provided to GET /api/runs", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockRequireAuth.mockImplementation((_req: any, res: any, _next: any) => {
      res.status(401).json({ error: "Unauthorized" });
    });
    const app = freshApp();
    const res = await request(app).get("/api/runs");
    expect(res.status).toBe(401);
  });

  it("returns 401 when no Bearer token is provided to POST /api/workflows/generate", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockRequireAuth.mockImplementation((_req: any, res: any, _next: any) => {
      res.status(401).json({ error: "Unauthorized" });
    });
    const app = freshApp();
    const res = await request(app)
      .post("/api/workflows/generate")
      .send({ description: "test" });
    expect(res.status).toBe(401);
  });

  it("allows authenticated requests through to POST /api/runs", async () => {
    const app = freshApp();
    // Valid auth, missing templateId → 400 not 401
    const res = await request(app).post("/api/runs").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/templateId/i);
  });
});

// ---------------------------------------------------------------------------
// Per-user rate-limiter (apiKeyLimiter) — authenticated routes
// ---------------------------------------------------------------------------

describe("Per-user rate-limiter (apiKeyLimiter)", () => {
  afterEach(() => {
    apiKeyLimiterMax = 100; // reset after each test
    ipLimiterMax = 1000;
    mockRequireAuth.mockImplementation(
      (req: Record<string, unknown>, _res: unknown, next: () => void) => {
        req.auth = { sub: mockAuthSub, email: "ratelimit@example.com" };
        next();
      }
    );
  });

  it("includes RateLimit-Limit header on authenticated routes", async () => {
    const app = freshApp();
    const res = await request(app).get("/api/runs");
    // Auth mock passes, so we reach the rate limiter
    expect([200, 400]).toContain(res.status);
    expect(res.headers["ratelimit-limit"]).toBeDefined();
  });

  it("returns 429 when per-user limit is exceeded on POST /api/runs", async () => {
    apiKeyLimiterMax = 1; // only 1 request allowed
    ipLimiterMax = 1000;  // don't trigger IP limiter

    const app = freshApp();

    // First request: auth passes, no templateId → 400 (correct business error)
    const first = await request(app).post("/api/runs").send({});
    expect(first.status).toBe(400);

    // Second request: same user, limit exhausted → 429
    const second = await request(app).post("/api/runs").send({ templateId: "t1" });
    expect(second.status).toBe(429);
    expect(second.body.error).toMatch(/rate limit/i);
  });
});
