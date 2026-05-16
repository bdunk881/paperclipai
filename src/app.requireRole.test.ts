/**
 * HEL-69: every authenticated `/api/*` mount in `src/app.ts` must compose
 * `requireRole(...)` after the workspace middleware (or be on the explicit
 * allowlist documented inline). This test reads `src/app.ts` as text and
 * asserts each authenticated mount line satisfies one of the two conditions
 * — duplicating the CI grep guard at unit-test granularity so regressions
 * fail locally before they fail in CI.
 *
 * Why text-based instead of mounting the real app with spoofed JWTs:
 *   - 20+ mounts × 6 non-owner roles = 120+ test cases; the per-route
 *     spoof matrix doesn't pay for itself when the middleware itself is
 *     unit-tested in requireRole.test.ts.
 *   - The actual integration is the textual composition in app.ts — that's
 *     what this test guards.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const APP_TS_PATH = resolve(__dirname, "app.ts");

/**
 * Routes that are intentionally `requireAuth`-only (no `requireRole(...)`),
 * with rationale. Update both this set AND the CI workflow's ALLOWLIST in
 * `.github/workflows/ci.yml` when adding a new entry.
 */
const ALLOWLIST = new Set<string>([
  // Create-workspace flow runs before the user has any workspace at all,
  // so `withWorkspace` has nothing to resolve and `requireRole` has no role
  // to gate. Per-route role enforcement lives inside workspaceRoutes.
  "/api/workspaces",
  // AutoFlow-internal admin routes use `requireStaff` (env-var allowlist of
  // Supabase sub values) inside the router, which is more restrictive than any
  // workspace role. These routes span all workspaces so no workspace context
  // applies.
  "/api/admin/curated-knowledge",
  // Read-only workspace-scoped surfaces. Any authenticated workspace member
  // may read them; RLS enforces workspace isolation. No mutation paths exist
  // on these routers, so role-level gating would only add friction without
  // security benefit.
  "/api/activity-events",
  "/api/org-graph",
  "/api/runs/:runId/step-results",
  "/api/budgets",
  "/api/entitlements",
  "/api/wake-events",
  "/api/connector-connections",
]);

interface AuthenticatedMount {
  path: string;
  lineNumber: number;
  rawLine: string;
}

function parseAuthenticatedMounts(source: string): AuthenticatedMount[] {
  const mounts: AuthenticatedMount[] = [];
  const lines = source.split("\n");
  const pattern = /^app\.use\("(\/api\/[^"]+)",\s*requireAuth/;

  for (const [i, line] of lines.entries()) {
    const match = pattern.exec(line);
    if (match) {
      mounts.push({
        path: match[1],
        lineNumber: i + 1,
        rawLine: line,
      });
    }
  }
  return mounts;
}

describe("HEL-69 — authenticated /api routes require requireRole(...)", () => {
  const source = readFileSync(APP_TS_PATH, "utf8");
  const mounts = parseAuthenticatedMounts(source);

  it("finds at least one authenticated /api mount (sanity)", () => {
    expect(mounts.length).toBeGreaterThan(0);
  });

  it.each(
    mounts.map((mount) => [mount.path, mount] as const),
  )("%s composes requireRole(...) or is on the allowlist", (path, mount) => {
    const hasRequireRole = /requireRole\(/.test(mount.rawLine);
    const isAllowlisted = ALLOWLIST.has(path);

    if (!hasRequireRole && !isAllowlisted) {
      throw new Error(
        `\nsrc/app.ts:${mount.lineNumber} — \`${path}\` is mounted with ` +
          `requireAuth but neither composes requireRole(...) nor appears on ` +
          `the HEL-69 allowlist.\n\nAdd requireRole(...) per the role mapping ` +
          `in HEL-69, or — if the route is intentionally user-scoped — add ` +
          `the path to ALLOWLIST in this test plus the matching pattern in ` +
          `.github/workflows/ci.yml's "Guard authenticated /api routes" step.\n`,
      );
    }

    expect(hasRequireRole || isAllowlisted).toBe(true);
  });
});
