/**
 * HEL-319: every admin-console route — reads included — must require an
 * AAL2 (stepped-up MFA) session, not just the mutation sub-routers.
 *
 * Regression guard: a platform admin authenticated at AAL1 (password only,
 * no MFA factor exercised) hitting a READ route must be turned away with
 * `401 mfa_step_up_required`, which the admin app's apiClient turns into a
 * passkey step-up. Before HEL-319 the read routers had no AAL2 gate, so a
 * leaked password gave full cross-tenant read access with no second factor.
 *
 * `jest.env.cjs` sets MFA_DISABLE_AAL2_ENFORCEMENT="true" for the rest of
 * the suite; we delete it here to exercise the real gate (and restore after).
 */

import express from "express";
import request from "supertest";
import type { Pool, PoolClient } from "pg";
import { createAdminConsoleRoutes } from "./index";

function fakePool(): Pool {
  const client = {
    async query(sql: string | { text: string }) {
      const text = typeof sql === "string" ? sql : sql.text;
      if (text.startsWith("SELECT is_platform_admin")) {
        return { rows: [{ is_platform_admin: true }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {
      /* no-op */
    },
  } as unknown as PoolClient;
  return { connect: async () => client } as unknown as Pool;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  // Stub requireAuth: an authenticated platform admin at AAL1 — password
  // only, so no `aal: "aal2"` claim, no MFA `amr` entry, no attestation cookie.
  app.use((req, _res, next) => {
    (req as unknown as { auth: unknown }).auth = {
      sub: "admin-1",
      email: "admin@helloautoflow.com",
    };
    next();
  });
  app.use("/api/admin-console", createAdminConsoleRoutes(fakePool()));
  return app;
}

describe("admin-console AAL2 enforcement (HEL-319)", () => {
  const original = process.env.MFA_DISABLE_AAL2_ENFORCEMENT;

  beforeEach(() => {
    delete process.env.MFA_DISABLE_AAL2_ENFORCEMENT;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.MFA_DISABLE_AAL2_ENFORCEMENT;
    else process.env.MFA_DISABLE_AAL2_ENFORCEMENT = original;
  });

  it("blocks a READ route with 401 mfa_step_up_required for an AAL1 platform admin", async () => {
    const res = await request(buildApp()).get("/api/admin-console/lookup");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "mfa_step_up_required" });
  });

  it("passes the AAL2 gate when enforcement is disabled (escape hatch parity)", async () => {
    process.env.MFA_DISABLE_AAL2_ENFORCEMENT = "true";
    const res = await request(buildApp()).get("/api/admin-console/lookup");
    // Past the gate: a non-401 status (the unmatched path 404s, which is fine —
    // the point is the request was NOT turned away by requireAAL2).
    expect(res.status).not.toBe(401);
  });

  it("exposes GET /session without AAL2 for platform admins", async () => {
    const res = await request(buildApp()).get("/api/admin-console/session");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      user_id: "admin-1",
      email: "admin@helloautoflow.com",
      is_platform_admin: true,
    });
  });

  it("blocks GET /step-up-probe without AAL2", async () => {
    const res = await request(buildApp()).get("/api/admin-console/step-up-probe");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "mfa_step_up_required" });
  });
});
