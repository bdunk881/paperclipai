/**
 * PR B.1 test for GET /api/hosted-free-models.
 */

import express from "express";
import request from "supertest";
import { createHostedFreeRoutes } from "./hostedFreeRoutes";

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/hosted-free-models", createHostedFreeRoutes());
  return app;
}

describe("GET /api/hosted-free-models", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENCODE_ZEN_API_KEY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns the catalog with availability=false when no env keys are set", async () => {
    const res = await request(buildApp()).get("/api/hosted-free-models");
    expect(res.status).toBe(200);
    expect(res.body.defaultProviderId).toBe("groq_llama_31_8b");
    expect(res.body.providers).toHaveLength(3);
    for (const p of res.body.providers) {
      expect(p.available).toBe(false);
    }
  });

  it("flips availability=true for providers whose env key IS set", async () => {
    process.env.GROQ_API_KEY = "gsk-test";
    const res = await request(buildApp()).get("/api/hosted-free-models");
    const groq8b = res.body.providers.find(
      (p: { id: string }) => p.id === "groq_llama_31_8b",
    );
    const bigPickle = res.body.providers.find(
      (p: { id: string }) => p.id === "opencode_zen_big_pickle",
    );
    expect(groq8b.available).toBe(true);
    expect(bigPickle.available).toBe(false);
  });

  it("marks Tier 2 as the default + carries warnings on Tier 1", async () => {
    const res = await request(buildApp()).get("/api/hosted-free-models");
    const tier1 = res.body.providers.find((p: { tier: number }) => p.tier === 1);
    const tier2 = res.body.providers.find((p: { tier: number }) => p.tier === 2);
    expect(tier2.isDefault).toBe(true);
    expect(tier1.isDefault).toBe(false);
    expect(tier1.warnings.length).toBeGreaterThan(0);
    expect(tier2.warnings).toEqual([]);
  });
});
