/**
 * HEL-440: AAL2 gating on the LLM credential/config router.
 *
 * Reads (GET list) must NOT require a stepped-up AAL2 session — a passkey
 * user whose 15-min attestation lapsed must still be able to see their
 * connected providers (Providers page, /hire model selector). Previously
 * requireAAL2 sat on the router mount and caught the GET too, silently
 * 401-looping returning users (HEL-435). Mutations stay gated.
 *
 * `jest.env.cjs` sets MFA_DISABLE_AAL2_ENFORCEMENT="true" for the rest of the
 * suite; we delete it here to exercise the real gate (and restore after).
 */
import express from "express";
import request from "supertest";

// Postgres is unavailable in this unit test; the GET handler's list path
// falls back to the in-memory store, so reads resolve without a live DB.
jest.mock("../db/postgres", () => ({
  getPostgresPool: jest.fn(() => ({})),
  isPostgresConfigured: jest.fn(() => false),
  isPostgresPersistenceEnabled: jest.fn(() => false),
  inMemoryAllowed: jest.fn(() => true),
}));

import llmConfigRoutes from "./llmConfigRoutes";

// Authenticated user at AAL1: password/passkey session but no `aal: "aal2"`
// claim, no MFA `amr` entry, and no attestation cookie — i.e. the lapsed
// state a returning user lands in.
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { auth: unknown }).auth = {
      sub: "user-1",
      email: "user@example.com",
    };
    next();
  });
  app.use("/api/llm-credentials", llmConfigRoutes);
  return app;
}

describe("llm-credential routes AAL2 gating (HEL-440)", () => {
  const original = process.env.MFA_DISABLE_AAL2_ENFORCEMENT;

  beforeEach(() => {
    delete process.env.MFA_DISABLE_AAL2_ENFORCEMENT;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.MFA_DISABLE_AAL2_ENFORCEMENT;
    else process.env.MFA_DISABLE_AAL2_ENFORCEMENT = original;
  });

  it("allows GET (list) at AAL1 — reads are not step-up-gated", async () => {
    const res = await request(buildApp()).get("/api/llm-credentials");
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
  });

  it("blocks POST (create) at AAL1 with 401 mfa_step_up_required", async () => {
    const res = await request(buildApp())
      .post("/api/llm-credentials")
      .send({ provider: "gemini", label: "Primary", model: "gemini-2.5-pro", apiKey: "abcd1234" });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "mfa_step_up_required" });
  });

  it("blocks PATCH (update) at AAL1 with 401 mfa_step_up_required", async () => {
    const res = await request(buildApp())
      .patch("/api/llm-credentials/some-id")
      .send({ label: "Renamed" });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "mfa_step_up_required" });
  });

  it("blocks PATCH (set default) at AAL1 with 401 mfa_step_up_required", async () => {
    const res = await request(buildApp()).patch("/api/llm-credentials/some-id/default");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "mfa_step_up_required" });
  });

  it("blocks DELETE at AAL1 with 401 mfa_step_up_required", async () => {
    const res = await request(buildApp()).delete("/api/llm-credentials/some-id");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "mfa_step_up_required" });
  });
});
