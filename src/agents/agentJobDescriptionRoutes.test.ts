/**
 * Coverage for the Job Description wizard route (Wave 3).
 *
 * Mocks the wizard helper at the module boundary so this stays a
 * pure HTTP test.
 */

jest.mock("./jobDescriptionWizard", () => ({
  draftAgentJobDescription: jest.fn(),
}));

import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { createAgentJobDescriptionRoutes } from "./agentJobDescriptionRoutes";
import { draftAgentJobDescription } from "./jobDescriptionWizard";

const mockedDraft = draftAgentJobDescription as jest.Mock;

// Stub pool — the agent-name lookup inside the route uses pool.connect
// via withWorkspaceContext, which will fail against a bare jest.fn().
// The route soft-fails that lookup and proceeds with a generic name,
// so the wizard still runs and the test asserts on the response shape.
const stubPool = { query: jest.fn() } as unknown as Parameters<typeof createAgentJobDescriptionRoutes>[0];

function buildApp(authOverrides: { sub?: string; workspaceId?: string } = {}) {
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
  app.use("/api/agents", createAgentJobDescriptionRoutes(stubPool));
  return app;
}

beforeEach(() => {
  mockedDraft.mockReset();
});

const WS = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";

describe("POST /api/agents/:agentId/job-description/draft", () => {
  it("returns 401 with no auth", async () => {
    const res = await request(buildApp({ workspaceId: WS }))
      .post(`/api/agents/${AGENT}/job-description/draft`)
      .send({ answers: { mission: "x", decisions: "x", asks: "x" } });
    expect(res.status).toBe(401);
  });

  it("returns 401 with no workspace", async () => {
    const res = await request(buildApp({ sub: "user-1" }))
      .post(`/api/agents/${AGENT}/job-description/draft`)
      .send({ answers: { mission: "x", decisions: "x", asks: "x" } });
    expect(res.status).toBe(401);
  });

  it("returns 400 on a malformed agent ID", async () => {
    const res = await request(buildApp({ sub: "user-1", workspaceId: WS }))
      .post("/api/agents/not-a-uuid/job-description/draft")
      .send({ answers: { mission: "x", decisions: "x", asks: "x" } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid agent ID/);
  });

  it("returns 400 when answers is missing entirely", async () => {
    const res = await request(buildApp({ sub: "user-1", workspaceId: WS }))
      .post(`/api/agents/${AGENT}/job-description/draft`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/answers/);
  });

  it("returns the drafted body on success", async () => {
    mockedDraft.mockResolvedValueOnce({
      title: "Generic — Job description",
      body: "## Mission\nx\n\n## How they work\ny\n\n## Hard rules\n- z",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      promptTokens: 1,
      completionTokens: 2,
    });

    const res = await request(buildApp({ sub: "user-1", workspaceId: WS }))
      .post(`/api/agents/${AGENT}/job-description/draft`)
      .send({
        answers: { mission: "do X", decisions: "ask when Y", asks: "Z" },
      });

    expect(res.status).toBe(200);
    expect(res.body.body).toContain("## Mission");
    expect(res.body.provider).toBe("anthropic");
  });

  it("maps VALIDATION -> 400", async () => {
    mockedDraft.mockRejectedValueOnce(
      Object.assign(new Error("mission is required"), { code: "VALIDATION" }),
    );

    const res = await request(buildApp({ sub: "user-1", workspaceId: WS }))
      .post(`/api/agents/${AGENT}/job-description/draft`)
      .send({ answers: { mission: "", decisions: "x", asks: "x" } });
    expect(res.status).toBe(400);
  });

  it("maps NO_PROVIDER -> 422", async () => {
    mockedDraft.mockRejectedValueOnce(
      Object.assign(new Error("No LLM provider configured."), {
        code: "NO_PROVIDER",
      }),
    );

    const res = await request(buildApp({ sub: "user-1", workspaceId: WS }))
      .post(`/api/agents/${AGENT}/job-description/draft`)
      .send({ answers: { mission: "x", decisions: "x", asks: "x" } });
    expect(res.status).toBe(422);
  });

  it("maps LLM_FAILED -> 502 with provider/model in the message", async () => {
    mockedDraft.mockRejectedValueOnce(
      Object.assign(
        new Error("Wizard call failed (mistral/mistral-large-latest): timeout"),
        { code: "LLM_FAILED" },
      ),
    );

    const res = await request(buildApp({ sub: "user-1", workspaceId: WS }))
      .post(`/api/agents/${AGENT}/job-description/draft`)
      .send({ answers: { mission: "x", decisions: "x", asks: "x" } });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain("mistral");
  });
});
