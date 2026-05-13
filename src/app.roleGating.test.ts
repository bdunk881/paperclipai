/**
 * HEL-69: Per-route role gating smoke tests.
 *
 * Verifies that every workspace-scoped route family 403s for roles that lack
 * permission and allows through roles that are in the declared set (plus owner
 * as implicit superuser).
 *
 * The workspace resolver is mocked to inject a role from the x-test-role header
 * so that actual DB membership queries are never performed.
 */

jest.mock("./engine/llmProviders", () => ({
  getProvider: jest.fn(),
}));

// Bypass rate limiting so the 100 req/min ceiling doesn't interfere with role checks.
jest.mock("express-rate-limit", () => {
  const passThrough = (_req: unknown, _res: unknown, next: () => void) => next();
  const mockRateLimit = jest.fn(() => passThrough);
  return { __esModule: true, default: mockRateLimit };
});

jest.mock("./auth/authMiddleware", () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.auth = { sub: "test-user-id", email: "test@example.com" };
    next();
  },
  requireAuthOrQaBypass: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.auth = { sub: "test-user-id", email: "test@example.com" };
    next();
  },
}));

jest.mock("./db/postgres", () => ({
  getPostgresPool: jest.fn(() => ({})),
  isPostgresConfigured: jest.fn(() => false),
  isPostgresPersistenceEnabled: jest.fn(() => false),
  inMemoryAllowed: jest.fn(() => true),
}));

// Role-injecting workspace resolver: reads role from x-test-role header.
// Used by both the Postgres path (createWorkspaceResolver) and the fallback
// path (createExplicitWorkspaceHeaderResolver) so the test works regardless of
// which branch isPostgresPersistenceEnabled() selects.
const makeRoleMiddleware = () =>
  (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const headers = (req.headers ?? {}) as Record<string, string>;
    const role = headers["x-test-role"] ?? "member";
    req.workspace = { id: "11111111-1111-4111-8111-111111111111", role };
    req.workspaceId = "11111111-1111-4111-8111-111111111111";
    next();
  };

jest.mock("./middleware/workspaceResolver", () => ({
  createWorkspaceResolver: jest.fn(() => makeRoleMiddleware()),
  createExplicitWorkspaceHeaderResolver: jest.fn(() => makeRoleMiddleware()),
}));

import request from "supertest";
import app from "./app";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withRole(role: string) {
  return request(app).get("/").set("x-test-role", role);
}

// ---------------------------------------------------------------------------
// admin + developer routes
// ---------------------------------------------------------------------------

describe.each([
  "/api/llm-configs",
  "/api/mcp/servers",
  "/api/memory",
  "/api/agents",
  "/api/knowledge/bases",
  "/api/integrations/connections",
  "/api/companies",
  "/api/routines",
])("admin+developer route — %s", (path) => {
  it.each(["operator", "billing", "approver", "member"])(
    "403 for insufficient role=%s",
    async (role) => {
      const res = await request(app).get(path).set("x-test-role", role);
      expect(res.status).toBe(403);
    },
  );

  it.each(["admin", "developer", "owner"])(
    "allows role=%s (not 403)",
    async (role) => {
      const res = await request(app).get(path).set("x-test-role", role);
      expect(res.status).not.toBe(403);
    },
  );
});

// ---------------------------------------------------------------------------
// admin + operator routes
// ---------------------------------------------------------------------------

describe.each([
  "/api/control-plane/teams",
  "/api/observability",
  "/api/reporting",
  "/api/tickets",
  "/api/ticket-sync/connections",
  "/api/notifications/preferences",
])("admin+operator route — %s", (path) => {
  it.each(["developer", "billing", "approver", "member"])(
    "403 for insufficient role=%s",
    async (role) => {
      const res = await request(app).get(path).set("x-test-role", role);
      expect(res.status).toBe(403);
    },
  );

  it.each(["admin", "operator", "owner"])(
    "allows role=%s (not 403)",
    async (role) => {
      const res = await request(app).get(path).set("x-test-role", role);
      expect(res.status).not.toBe(403);
    },
  );
});

// ---------------------------------------------------------------------------
// admin + approver + operator routes
// ---------------------------------------------------------------------------

describe.each([
  "/api/hitl/companies/test-company/state",
  "/api/approval-policies",
])("admin+approver+operator route — %s", (path) => {
  it.each(["developer", "billing", "member"])(
    "403 for insufficient role=%s",
    async (role) => {
      const res = await request(app).get(path).set("x-test-role", role);
      expect(res.status).toBe(403);
    },
  );

  it.each(["admin", "approver", "operator", "owner"])(
    "allows role=%s (not 403)",
    async (role) => {
      const res = await request(app).get(path).set("x-test-role", role);
      expect(res.status).not.toBe(403);
    },
  );
});

// ---------------------------------------------------------------------------
// billing role (checkout + subscription)
// ---------------------------------------------------------------------------

describe.each(["/api/billing/checkout", "/api/billing/subscription"])(
  "billing route — %s",
  (path) => {
    it.each(["admin", "developer", "operator", "approver", "member"])(
      "403 for non-billing role=%s",
      async (role) => {
        const res = await request(app).get(path).set("x-test-role", role);
        expect(res.status).toBe(403);
      },
    );

    it.each(["billing", "owner"])("allows role=%s (not 403)", async (role) => {
      const res = await request(app).get(path).set("x-test-role", role);
      expect(res.status).not.toBe(403);
    });
  },
);

// ---------------------------------------------------------------------------
// Workspace management — allowlisted (no requireRole, user-scoped)
// ---------------------------------------------------------------------------

describe("workspace management routes bypass role gating", () => {
  it("GET /api/workspaces is reachable with any role (member)", async () => {
    // Workspace management is user-scoped — must not return 403 for any auth'd user.
    const res = await request(app).get("/api/workspaces").set("x-test-role", "member");
    expect(res.status).not.toBe(403);
  });
});
