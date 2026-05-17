/**
 * PR B.1 test for GET /api/hosted-free-models.
 */

import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { createHostedFreeRoutes } from "./hostedFreeRoutes";
import {
  recordHostedFreeTokens,
  resetHostedFreeUsageForTests,
} from "./usageStore";

function buildApp(workspaceId: string | null = null): express.Express {
  const app = express();
  app.use(express.json());
  // Stand-in for workspaceResolver — the real one reads
  // X-Workspace-Id + RLS; the route only needs `req.workspace?.id`.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (workspaceId) {
      (req as Request & { workspace?: { id: string; role: string } }).workspace = {
        id: workspaceId,
        role: "owner",
      };
    }
    next();
  });
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

  // PR B.2: usage snapshot piggybacks on the catalog response so the
  // dashboard only needs one round-trip to render the LLM Providers
  // page's hosted-free section.
  describe("PR B.2 usage snapshot", () => {
    beforeEach(() => {
      resetHostedFreeUsageForTests();
    });

    it("returns a zeroed usage snapshot when no workspace context is attached", async () => {
      const res = await request(buildApp(null)).get("/api/hosted-free-models");
      expect(res.body.usage).toMatchObject({
        workspaceId: null,
        usedTokens: 0,
        capTokens: 0,
        exceeded: false,
        warning: false,
      });
    });

    it("returns the active workspace's daily usage when workspaceResolver populated req.workspace", async () => {
      const ws = "ws-route-test";
      recordHostedFreeTokens(ws, 12_345);
      const res = await request(buildApp(ws)).get("/api/hosted-free-models");
      expect(res.body.usage).toMatchObject({
        workspaceId: ws,
        usedTokens: 12_345,
        capTokens: 50_000,
        remainingTokens: 50_000 - 12_345,
        exceeded: false,
        warning: false,
      });
    });

    it("flips warning=true at >= 80% used", async () => {
      const ws = "ws-route-warn";
      recordHostedFreeTokens(ws, 40_000); // exactly 80%
      const res = await request(buildApp(ws)).get("/api/hosted-free-models");
      expect(res.body.usage.warning).toBe(true);
      expect(res.body.usage.exceeded).toBe(false);
    });

    it("flips exceeded=true at the cap", async () => {
      const ws = "ws-route-exceeded";
      recordHostedFreeTokens(ws, 50_000);
      const res = await request(buildApp(ws)).get("/api/hosted-free-models");
      expect(res.body.usage.exceeded).toBe(true);
      expect(res.body.usage.remainingTokens).toBe(0);
    });
  });
});
