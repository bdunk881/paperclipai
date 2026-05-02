/**
 * API contract tests for uncovered app.ts routes:
 * - GET/POST /api/approvals
 * - POST /api/workflows/generate
 * - POST /api/runs/file
 */

jest.mock("./engine/llmProviders", () => ({
  getProvider: jest.fn(),
}));

// Bypass JWT verification in unit tests — inject a synthetic auth principal
jest.mock("./auth/authMiddleware", () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const headers = (req.headers ?? {}) as Record<string, unknown>;
    const requestedUserId = typeof headers["x-user-id"] === "string" ? headers["x-user-id"] : "test-user-id";
    req.auth = { sub: requestedUserId, email: "test@example.com" };
    next();
  },
  requireAuthOrQaBypass: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const headers = (req.headers ?? {}) as Record<string, unknown>;
    const requestedUserId = typeof headers["x-user-id"] === "string" ? headers["x-user-id"] : "test-user-id";
    req.auth = { sub: requestedUserId, email: "test@example.com" };
    next();
  },
}));

import request from "supertest";
import app from "./app";
import { approvalStore } from "./engine/approvalStore";
import { approvalNotificationStore } from "./engine/approvalNotificationStore";
import { runStore } from "./engine/runStore";
import { getProvider } from "./engine/llmProviders";
import { llmConfigStore } from "./llmConfig/llmConfigStore";

const mockGetProvider = getProvider as jest.Mock;

beforeEach(async () => {
  await approvalStore.clear();
  await approvalNotificationStore.clear();
  await runStore.clear();
  llmConfigStore.clear();
  mockGetProvider.mockReset();
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// GET /api/approvals
// ---------------------------------------------------------------------------

describe("GET /api/approvals", () => {
  it("returns 200 with empty list when no approvals exist", async () => {
    const res = await request(app).get("/api/approvals");
    expect(res.status).toBe(200);
    expect(res.body.approvals).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("returns all approvals without status filter", async () => {
    await approvalStore.create({ runId: "r1", templateName: "T", stepId: "s1", stepName: "Step", assignee: "test-user-id", message: "approve?", timeoutMinutes: 60, userId: "test-user-id" });
    const res = await request(app).get("/api/approvals");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it("filters by status=pending", async () => {
    await approvalStore.create({ runId: "r2", templateName: "T", stepId: "s2", stepName: "Step", assignee: "test-user-id", message: "approve?", timeoutMinutes: 60, userId: "test-user-id" });
    const res = await request(app).get("/api/approvals?status=pending");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.approvals[0].status).toBe("pending");
  });

  it("ignores invalid status filter and returns all", async () => {
    await approvalStore.create({ runId: "r3", templateName: "T", stepId: "s3", stepName: "Step", assignee: "test-user-id", message: "approve?", timeoutMinutes: 60, userId: "test-user-id" });
    const res = await request(app).get("/api/approvals?status=invalid");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it("filters by status=approved returns empty when none resolved", async () => {
    await approvalStore.create({ runId: "r4", templateName: "T", stepId: "s4", stepName: "Step", assignee: "test-user-id", message: "approve?", timeoutMinutes: 60, userId: "test-user-id" });
    const res = await request(app).get("/api/approvals?status=approved");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GET /api/approvals/:id
// ---------------------------------------------------------------------------

describe("GET /api/approvals/:id", () => {
  it("returns 200 with the approval for a known id", async () => {
    const { id } = await approvalStore.create({ runId: "r1", templateName: "T", stepId: "s1", stepName: "Step", assignee: "test-user-id", message: "approve?", timeoutMinutes: 60, userId: "test-user-id" });
    const res = await request(app).get(`/api/approvals/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.status).toBe("pending");
  });

  it("returns 404 for unknown approval id", async () => {
    const res = await request(app).get("/api/approvals/no-such-id");
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("not found");
  });
});

describe("GET /api/approvals/:id/notifications", () => {
  it("returns notification outbox rows for a known approval id", async () => {
    const { id } = await approvalStore.create({ runId: "r-notify", templateName: "T", stepId: "s-notify", stepName: "Step", assignee: "test-user-id", message: "approve?", timeoutMinutes: 60, userId: "test-user-id" });
    const res = await request(app).get(`/api/approvals/${id}/notifications`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.notifications.map((n: { channel: string }) => n.channel)).toEqual(["inbox", "email"]);
  });

  it("returns 404 for an unknown approval id", async () => {
    const res = await request(app).get("/api/approvals/no-such-id/notifications");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/approvals/:id/resolve
// ---------------------------------------------------------------------------

describe("POST /api/approvals/:id/resolve", () => {
  it("returns 400 when decision is not approved, rejected, or request_changes", async () => {
    const { id } = await approvalStore.create({ runId: "r1", templateName: "T", stepId: "s1", stepName: "Step", assignee: "test-user-id", message: "approve?", timeoutMinutes: 60, userId: "test-user-id" });
    const res = await request(app)
      .post(`/api/approvals/${id}/resolve`)
      .send({ decision: "maybe" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/decision/);
  });

  it("resolves approved and returns success=true", async () => {
    const { id } = await approvalStore.create({ runId: "r2", templateName: "T", stepId: "s2", stepName: "Step", assignee: "test-user-id", message: "approve?", timeoutMinutes: 60, userId: "test-user-id" });
    const res = await request(app)
      .post(`/api/approvals/${id}/resolve`)
      .send({ decision: "approved" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("resolves rejected and returns success=true", async () => {
    const { id } = await approvalStore.create({ runId: "r3", templateName: "T", stepId: "s3", stepName: "Step", assignee: "test-user-id", message: "approve?", timeoutMinutes: 60, userId: "test-user-id" });
    const res = await request(app)
      .post(`/api/approvals/${id}/resolve`)
      .send({ decision: "rejected", comment: "Not ready" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("resolves request_changes and returns success=true", async () => {
    const { id } = await approvalStore.create({ runId: "r-request-changes", templateName: "T", stepId: "s5", stepName: "Step", assignee: "test-user-id", message: "approve?", timeoutMinutes: 60, userId: "test-user-id" });
    const res = await request(app)
      .post(`/api/approvals/${id}/resolve`)
      .send({ decision: "request_changes", comment: "Revise the previous step" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 404 for unknown approval id", async () => {
    const res = await request(app)
      .post("/api/approvals/no-such-id/resolve")
      .send({ decision: "approved" });
    expect(res.status).toBe(404);
  });

  it("returns 404 for already-resolved approval", async () => {
    const { id } = await approvalStore.create({ runId: "r4", templateName: "T", stepId: "s4", stepName: "Step", assignee: "test-user-id", message: "approve?", timeoutMinutes: 60, userId: "test-user-id" });
    await approvalStore.resolve(id, "approved");
    const res = await request(app)
      .post(`/api/approvals/${id}/resolve`)
      .send({ decision: "approved" });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/executions/:id/state
// ---------------------------------------------------------------------------

describe("GET /api/executions/:id/state", () => {
  it("returns paused execution state for an awaiting approval run", async () => {
    const workflowEngineModule = await import("./engine/WorkflowEngine");
    const { customerSupportBot } = await import("./templates/customer-support-bot");

    const template = {
      ...customerSupportBot,
      id: "tpl-approval-state",
      steps: [
        customerSupportBot.steps[0],
        {
          id: "approval-1",
          name: "Approval checkpoint",
          kind: "approval" as const,
          description: "Human approval required",
          inputKeys: [],
          outputKeys: ["approved"],
          approvalAssignee: "manager",
          approvalMessage: "Please approve",
          approvalTimeoutMinutes: 5,
        },
      ],
    };

    const run = await workflowEngineModule.workflowEngine.startRun(template, {
      ticketId: "T-state",
      subject: "Approval needed",
      body: "Pause here",
      customerEmail: "state@example.com",
      channel: "email",
    });

    const deadline = Date.now() + 2000;
    let stateRes;
    do {
      stateRes = await request(app).get(`/api/executions/${run.id}/state`);
      if (stateRes.status === 200) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    } while (Date.now() < deadline);

    expect(stateRes!.status).toBe(200);
    expect(stateRes!.body.run.id).toBe(run.id);
    expect(stateRes!.body.run.status).toBe("awaiting_approval");
    expect(stateRes!.body.approval.runId).toBe(run.id);
    expect(stateRes!.body.pausedAtStepId).toBe("approval-1");
    expect(stateRes!.body.runtimeState.currentStepIndex).toBe(1);
    expect(stateRes!.body.runtimeState.waitingApprovalId).toBe(stateRes!.body.approval.id);

    await approvalStore.resolve(stateRes!.body.approval.id, "approved", "ok");
  });

  it("returns 404 for unknown execution id", async () => {
    const res = await request(app).get("/api/executions/no-such-run/state");
    expect(res.status).toBe(404);
  });

  it("returns 409 when execution is not awaiting approval", async () => {
    const workflowEngineModule = await import("./engine/WorkflowEngine");
    const run = await workflowEngineModule.workflowEngine.startRun(
      {
        id: "tpl-non-paused",
        name: "Immediate output",
        description: "No approval step",
        category: "custom",
        version: "1",
        configFields: [],
        steps: [
          {
            id: "trigger-1",
            name: "Trigger",
            kind: "trigger",
            description: "Start",
            inputKeys: ["message"],
            outputKeys: ["message"],
          },
          {
            id: "output-1",
            name: "Output",
            kind: "output",
            description: "Finish",
            inputKeys: ["message"],
            outputKeys: ["message"],
          },
        ],
        sampleInput: { message: "hello" },
        expectedOutput: { message: "hello" },
      },
      { message: "hello" }
    );

    const deadline = Date.now() + 2000;
    let current;
    do {
      current = await runStore.get(run.id);
      if (current?.status === "completed" || current?.status === "failed") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    } while (Date.now() < deadline);

    const res = await request(app).get(`/api/executions/${run.id}/state`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not currently paused/);
  });
});

describe("POST /api/executions/:id/resume", () => {
  it("resumes a paused execution after the approval is already resolved", async () => {
    const waitSpy = jest.spyOn(approvalStore, "waitForDecision").mockImplementation(
      async () => await new Promise(() => {})
    );
    const workflowEngineModule = await import("./engine/WorkflowEngine");

    const template = {
      id: "tpl-manual-resume",
      name: "Manual resume",
      description: "Resume after a lost live worker",
      category: "custom" as const,
      version: "1",
      configFields: [],
      steps: [
        {
          id: "trigger-1",
          name: "Trigger",
          kind: "trigger" as const,
          description: "Start",
          inputKeys: ["message"],
          outputKeys: ["message"],
        },
        {
          id: "approval-1",
          name: "Approval checkpoint",
          kind: "approval" as const,
          description: "Pause",
          inputKeys: ["message"],
          outputKeys: ["approved"],
          approvalAssignee: "manager",
          approvalMessage: "Please approve",
          approvalTimeoutMinutes: 5,
        },
        {
          id: "output-1",
          name: "Output",
          kind: "output" as const,
          description: "Finish",
          inputKeys: ["message", "approvalDecision", "approverComment"],
          outputKeys: ["message", "approvalDecision", "approverComment"],
        },
      ],
      sampleInput: { message: "hello" },
      expectedOutput: { message: "hello" },
    };
    const templatesModule = await import("./templates");
    templatesModule.TEMPLATE_MAP[template.id] = template;

    const run = await workflowEngineModule.workflowEngine.startRun(template, {
      message: "hello",
    });

    const deadline = Date.now() + 2000;
    let pendingApprovalId: string | undefined;
    while (Date.now() < deadline) {
      const state = await runStore.get(run.id);
      const pendingApprovals = await approvalStore.list("pending");
      const pending = pendingApprovals.find((approval) => approval.runId === run.id);
      if (state?.status === "awaiting_approval" && pending) {
        pendingApprovalId = pending.id;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(pendingApprovalId).toBeDefined();
    await approvalStore.resolve(pendingApprovalId!, "approved", "resume now");

    const res = await request(app).post(`/api/executions/${run.id}/resume`).send({});
    expect(res.status).toBe(202);

    let completed;
    while (Date.now() < deadline) {
      completed = await runStore.get(run.id);
      if (completed?.status === "completed") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(completed?.status).toBe("completed");
    expect(completed?.output).toMatchObject({
      message: "hello",
      approvalDecision: "approved",
      approverComment: "resume now",
    });
    waitSpy.mockRestore();
    delete templatesModule.TEMPLATE_MAP[template.id];
  });

  it("returns 409 when the approval is still pending", async () => {
    const waitSpy = jest.spyOn(approvalStore, "waitForDecision").mockImplementation(
      async () => await new Promise(() => {})
    );
    const workflowEngineModule = await import("./engine/WorkflowEngine");
    const { customerSupportBot } = await import("./templates/customer-support-bot");

    const template = {
      ...customerSupportBot,
      id: "tpl-pending-resume",
      steps: [
        customerSupportBot.steps[0],
        {
          id: "approval-1",
          name: "Approval checkpoint",
          kind: "approval" as const,
          description: "Pause",
          inputKeys: ["subject"],
          outputKeys: ["approved"],
          approvalAssignee: "manager",
          approvalMessage: "Please approve",
          approvalTimeoutMinutes: 5,
        },
      ],
    };
    const templatesModule = await import("./templates");
    templatesModule.TEMPLATE_MAP[template.id] = template;

    const run = await workflowEngineModule.workflowEngine.startRun(template, {
      ticketId: "T-pending",
      subject: "Needs approval",
      body: "body",
      customerEmail: "pending@example.com",
      channel: "email",
    });

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const state = await runStore.get(run.id);
      if (state?.status === "awaiting_approval") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const res = await request(app).post(`/api/executions/${run.id}/resume`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/still pending/i);
    waitSpy.mockRestore();
    delete templatesModule.TEMPLATE_MAP[template.id];
  });
});

// ---------------------------------------------------------------------------
// POST /api/workflows/generate
// ---------------------------------------------------------------------------

describe("POST /api/workflows/generate", () => {
  it("returns 400 when description is missing", async () => {
    const res = await request(app)
      .post("/api/workflows/generate")
      .set("X-User-Id", "user-1")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/description/);
  });

  it("returns 400 when description is empty string", async () => {
    const res = await request(app)
      .post("/api/workflows/generate")
      .set("X-User-Id", "user-1")
      .send({ description: "  " });
    expect(res.status).toBe(400);
  });

  it("returns 422 when no LLM provider configured (identity from JWT, not X-User-Id)", async () => {
    // User identity is now extracted from the validated JWT, not the X-User-Id header.
    // A valid request without any LLM config returns 422, not 401.
    const res = await request(app)
      .post("/api/workflows/generate")
      .send({ description: "Build a support bot" });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/No LLM provider/);
  });

  it("returns 422 when no LLM provider configured for user", async () => {
    const res = await request(app)
      .post("/api/workflows/generate")
      .set("X-User-Id", "user-no-llm")
      .send({ description: "Build a support bot" });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/No LLM provider/);
  });

  it("uses the first provider config even before an explicit default is manually chosen", async () => {
    llmConfigStore.create({
      userId: "user-mistral",
      provider: "mistral",
      label: "Mistral Key",
      model: "mistral-large-latest",
      credentials: { apiKey: "mistral-key-1234" },
    });
    mockGetProvider.mockReturnValue(async () => ({
      text: JSON.stringify([
        { id: "step-1", name: "Trigger", kind: "trigger", description: "d", inputKeys: [], outputKeys: [] },
      ]),
    }));

    const res = await request(app)
      .post("/api/workflows/generate")
      .set("X-User-Id", "user-mistral")
      .send({ description: "Build a support bot" });

    expect(res.status).toBe(200);
    expect(mockGetProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "mistral",
        model: "mistral-large-latest",
        apiKey: "mistral-key-1234",
      })
    );
  });

  it("returns 502 when LLM call fails", async () => {
    const { llmConfigStore } = await import("./llmConfig/llmConfigStore");
    jest.spyOn(llmConfigStore, "getDecryptedDefault").mockReturnValue({
      config: { provider: "openai", model: "gpt-4" },
      apiKey: "sk-test",
    } as ReturnType<typeof llmConfigStore.getDecryptedDefault>);
    mockGetProvider.mockReturnValue(async () => { throw new Error("timeout"); });

    const res = await request(app)
      .post("/api/workflows/generate")
      .set("X-User-Id", "user-1")
      .send({ description: "Build a support bot" });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/LLM call failed/);
  });

  it("returns 422 when LLM returns non-JSON", async () => {
    const { llmConfigStore } = await import("./llmConfig/llmConfigStore");
    jest.spyOn(llmConfigStore, "getDecryptedDefault").mockReturnValue({
      config: { provider: "openai", model: "gpt-4" },
      apiKey: "sk-test",
    } as ReturnType<typeof llmConfigStore.getDecryptedDefault>);
    mockGetProvider.mockReturnValue(async () => ({ text: "not valid json at all" }));

    const res = await request(app)
      .post("/api/workflows/generate")
      .set("X-User-Id", "user-1")
      .send({ description: "Build a support bot" });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/invalid JSON/);
  });

  it("returns 422 when LLM returns JSON non-array", async () => {
    const { llmConfigStore } = await import("./llmConfig/llmConfigStore");
    jest.spyOn(llmConfigStore, "getDecryptedDefault").mockReturnValue({
      config: { provider: "openai", model: "gpt-4" },
      apiKey: "sk-test",
    } as ReturnType<typeof llmConfigStore.getDecryptedDefault>);
    mockGetProvider.mockReturnValue(async () => ({ text: '{"not":"an array"}' }));

    const res = await request(app)
      .post("/api/workflows/generate")
      .set("X-User-Id", "user-1")
      .send({ description: "Build a support bot" });
    expect(res.status).toBe(422);
  });

  it("returns 200 steps array on valid LLM response", async () => {
    const steps = [{ id: "step-1", name: "Trigger", kind: "trigger", description: "d", inputKeys: [], outputKeys: [] }];
    const { llmConfigStore } = await import("./llmConfig/llmConfigStore");
    jest.spyOn(llmConfigStore, "getDecryptedDefault").mockReturnValue({
      config: { provider: "openai", model: "gpt-4" },
      apiKey: "sk-test",
    } as ReturnType<typeof llmConfigStore.getDecryptedDefault>);
    mockGetProvider.mockReturnValue(async () => ({ text: JSON.stringify(steps) }));

    const res = await request(app)
      .post("/api/workflows/generate")
      .set("X-User-Id", "user-1")
      .send({ description: "Build a support bot" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.steps)).toBe(true);
  });

  it("strips markdown code fences from LLM response", async () => {
    const steps = [{ id: "step-1", name: "Trigger", kind: "trigger", description: "d", inputKeys: [], outputKeys: [] }];
    const { llmConfigStore } = await import("./llmConfig/llmConfigStore");
    jest.spyOn(llmConfigStore, "getDecryptedDefault").mockReturnValue({
      config: { provider: "openai", model: "gpt-4" },
      apiKey: "sk-test",
    } as ReturnType<typeof llmConfigStore.getDecryptedDefault>);
    mockGetProvider.mockReturnValue(async () => ({ text: "```json\n" + JSON.stringify(steps) + "\n```" }));

    const res = await request(app)
      .post("/api/workflows/generate")
      .set("X-User-Id", "user-1")
      .send({ description: "Build a support bot" });
    expect(res.status).toBe(200);
    expect(res.body.steps).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// POST /api/goals/team-assembly
// ---------------------------------------------------------------------------

describe("POST /api/goals/team-assembly", () => {
  const normalizedGoalDocument = {
    sourceType: "free_text" as const,
    goal: "Launch an AI bookkeeping concierge",
    targetCustomer: "Shopify brands doing $1M-$10M in annual revenue.",
    successMetrics: [
      "Reach 20 pilot customers in 6 months",
      "Reduce monthly close time from 10 days to 3 days",
    ],
    constraints: [
      "Must integrate with Shopify and QuickBooks in v1",
      "Keep launch budget under $75k",
    ],
    budget: "$75k for MVP development and GTM validation",
    timeHorizon: "Launch paid pilots within 6 months",
    importedContextSummary: null,
    planReadinessThreshold: 0.8,
  };

  const prd = {
    title: "AI Bookkeeping Concierge for Shopify Brands",
    summary: "Provide an AI-first concierge that closes monthly books and flags anomalies.",
    targetCustomer: "Shopify brands doing $1M-$10M in annual revenue.",
    problemStatement: "Operators lose time reconciling transactions and miss cash flow issues.",
    proposedSolution: "An AI concierge that ingests store, banking, and expense data and delivers weekly digests.",
    successMetrics: [
      "Reduce monthly close time from 10 days to 3 days",
      "Reach 20 paid pilot accounts in 6 months",
    ],
    constraints: [
      "Must integrate with Shopify and QuickBooks in v1",
      "No human bookkeeper required for standard reconciliation flows",
    ],
    budget: "$75k for MVP development and GTM validation",
    timeHorizon: "Launch paid pilots within 6 months",
    assumptions: ["Customers will connect their financial systems self-serve."],
    risks: ["Data quality may vary across merchant accounting setups."],
    openQuestions: [],
  };

  it("returns 400 when normalizedGoalDocument is missing", async () => {
    const res = await request(app)
      .post("/api/goals/team-assembly")
      .set("X-User-Id", "user-team-assembly-validation")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/normalizedGoalDocument/i);
  });

  it("returns 422 when no LLM provider configured", async () => {
    const res = await request(app)
      .post("/api/goals/team-assembly")
      .set("X-User-Id", "user-team-assembly-no-llm")
      .send({ normalizedGoalDocument });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/No LLM provider/);
  });

  it("returns 422 when the LLM response is invalid JSON", async () => {
    const { llmConfigStore } = await import("./llmConfig/llmConfigStore");
    jest.spyOn(llmConfigStore, "getDecryptedDefault").mockReturnValue({
      config: { provider: "openai", model: "gpt-4" },
      apiKey: "sk-test",
    } as ReturnType<typeof llmConfigStore.getDecryptedDefault>);
    mockGetProvider.mockReturnValue(async () => ({ text: "not valid json at all" }));

    const res = await request(app)
      .post("/api/goals/team-assembly")
      .set("X-User-Id", "user-team-assembly-invalid-json")
      .send({ normalizedGoalDocument, prd });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/invalid JSON/);
  });

  it("returns a structured team assembly plan", async () => {
    const { llmConfigStore } = await import("./llmConfig/llmConfigStore");
    jest.spyOn(llmConfigStore, "getDecryptedDefault").mockReturnValue({
      config: { provider: "openai", model: "gpt-4" },
      apiKey: "sk-test",
    } as ReturnType<typeof llmConfigStore.getDecryptedDefault>);
    mockGetProvider.mockReturnValue(async () => ({
      text: JSON.stringify({
        schemaVersion: "2026-04-27",
        company: {
          name: "LedgerPilot",
          goal: normalizedGoalDocument.goal,
          targetCustomer: normalizedGoalDocument.targetCustomer,
          budget: normalizedGoalDocument.budget,
          timeHorizon: normalizedGoalDocument.timeHorizon,
        },
        summary: "Launch a lean finance-focused company with product, growth, and revenue leadership.",
        rationale: "The product needs a small cross-functional team to ship integrations, acquire pilots, and control spend.",
        orgChart: {
          executives: [
            {
              roleKey: "ceo",
              title: "CEO",
              roleType: "executive",
              department: "executive",
              headcount: 1,
              reportsToRoleKey: null,
              mandate: "Own strategy and cross-functional execution.",
              justification: "A coordinating executive is required to translate the goal into weekly priorities.",
              kpis: ["Pilot customer count", "Plan completion rate"],
              skills: ["paperclip"],
              tools: ["notion", "slack", "github"],
              modelTier: "power",
              budgetMonthlyUsd: 1200,
              provisioningInstructions: "Provision as the top-level planner with access to company memory.",
            },
            {
              roleKey: "cto",
              title: "CTO",
              roleType: "executive",
              department: "engineering",
              headcount: 1,
              reportsToRoleKey: "ceo",
              mandate: "Own product delivery and technical roadmap.",
              justification: "The business depends on integrations and reliable automation.",
              kpis: ["Integration milestones shipped", "Defect escape rate"],
              skills: ["paperclip", "cto-routines"],
              tools: ["github", "vercel"],
              modelTier: "power",
              budgetMonthlyUsd: 1000,
              provisioningInstructions: "Provision with engineering planning and repo access.",
            },
          ],
          operators: [
            {
              roleKey: "backend-engineer",
              title: "Backend Engineer",
              roleType: "operator",
              department: "engineering",
              headcount: 1,
              reportsToRoleKey: "cto",
              mandate: "Build integrations and bookkeeping workflow APIs.",
              justification: "Core product value depends on data ingestion and reconciliation logic.",
              kpis: ["Integration test pass rate", "Time to ship new connector"],
              skills: ["paperclip", "nodejs-backend-patterns"],
              tools: ["github", "vercel"],
              modelTier: "standard",
              budgetMonthlyUsd: 700,
              provisioningInstructions: "Provision with backend implementation skills and integration context.",
            },
          ],
          reportingLines: [
            { managerRoleKey: "ceo", reportRoleKey: "cto" },
            { managerRoleKey: "cto", reportRoleKey: "backend-engineer" },
          ],
        },
        provisioningPlan: {
          teamName: "LedgerPilot Launch Team",
          deploymentMode: "continuous_agents",
          agents: [
            {
              roleKey: "ceo",
              title: "CEO",
              roleType: "executive",
              department: "executive",
              headcount: 1,
              reportsToRoleKey: null,
              mandate: "Own strategy and cross-functional execution.",
              justification: "A coordinating executive is required to translate the goal into weekly priorities.",
              kpis: ["Pilot customer count", "Plan completion rate"],
              skills: ["paperclip"],
              tools: ["notion", "slack", "github"],
              modelTier: "power",
              budgetMonthlyUsd: 1200,
              provisioningInstructions: "Provision as the top-level planner with access to company memory.",
            },
            {
              roleKey: "cto",
              title: "CTO",
              roleType: "executive",
              department: "engineering",
              headcount: 1,
              reportsToRoleKey: "ceo",
              mandate: "Own product delivery and technical roadmap.",
              justification: "The business depends on integrations and reliable automation.",
              kpis: ["Integration milestones shipped", "Defect escape rate"],
              skills: ["paperclip", "cto-routines"],
              tools: ["github", "vercel"],
              modelTier: "power",
              budgetMonthlyUsd: 1000,
              provisioningInstructions: "Provision with engineering planning and repo access.",
            },
            {
              roleKey: "backend-engineer",
              title: "Backend Engineer",
              roleType: "operator",
              department: "engineering",
              headcount: 1,
              reportsToRoleKey: "cto",
              mandate: "Build integrations and bookkeeping workflow APIs.",
              justification: "Core product value depends on data ingestion and reconciliation logic.",
              kpis: ["Integration test pass rate", "Time to ship new connector"],
              skills: ["paperclip", "nodejs-backend-patterns"],
              tools: ["github", "vercel"],
              modelTier: "standard",
              budgetMonthlyUsd: 700,
              provisioningInstructions: "Provision with backend implementation skills and integration context.",
            },
          ],
        },
        roadmap306090: {
          day30: {
            objectives: ["Validate integration scope and staffing assumptions"],
            deliverables: ["Approved architecture plan", "Pilot pipeline definition"],
            ownerRoleKeys: ["ceo", "cto"],
          },
          day60: {
            objectives: ["Ship core integrations and recruit design partners"],
            deliverables: ["QuickBooks connector", "Outbound pilot campaign"],
            ownerRoleKeys: ["cto", "backend-engineer"],
          },
          day90: {
            objectives: ["Launch paid pilots and instrument operating metrics"],
            deliverables: ["Pilot onboarding workflow", "Weekly finance dashboard"],
            ownerRoleKeys: ["ceo", "backend-engineer"],
          },
        },
      }),
    }));

    const res = await request(app)
      .post("/api/goals/team-assembly")
      .set("X-User-Id", "user-team-assembly-success")
      .send({
        companyName: "LedgerPilot",
        normalizedGoalDocument,
        prd,
      });

    expect(res.status).toBe(200);
    expect(res.body.schemaVersion).toBe("2026-04-27");
    expect(res.body.orgChart.executives).toHaveLength(2);
    expect(res.body.provisioningPlan.agents).toHaveLength(3);
    expect(res.body.roadmap306090.day90.ownerRoleKeys).toContain("ceo");
  });

  it("passes the role library and PRD into the prompt", async () => {
    const { llmConfigStore } = await import("./llmConfig/llmConfigStore");
    jest.spyOn(llmConfigStore, "getDecryptedDefault").mockReturnValue({
      config: { provider: "openai", model: "gpt-4" },
      apiKey: "sk-test",
    } as ReturnType<typeof llmConfigStore.getDecryptedDefault>);

    const providerMock = jest.fn(async () => ({
      text: JSON.stringify({
        schemaVersion: "2026-04-27",
        company: {
          name: "LedgerPilot",
          goal: normalizedGoalDocument.goal,
          targetCustomer: normalizedGoalDocument.targetCustomer,
          budget: normalizedGoalDocument.budget,
          timeHorizon: normalizedGoalDocument.timeHorizon,
        },
        summary: "Lean plan",
        rationale: "Use a minimal org to reach pilots quickly.",
        orgChart: {
          executives: [],
          operators: [
            {
              roleKey: "backend-engineer",
              title: "Backend Engineer",
              roleType: "operator",
              department: "engineering",
              headcount: 1,
              reportsToRoleKey: null,
              mandate: "Build the MVP backend.",
              justification: "The MVP is integration-heavy.",
              kpis: ["API milestones"],
              skills: ["paperclip"],
              tools: ["github"],
              modelTier: "standard",
              budgetMonthlyUsd: 700,
              provisioningInstructions: "Provision as an implementation agent.",
            },
          ],
          reportingLines: [],
        },
        provisioningPlan: {
          teamName: "LedgerPilot Launch Team",
          deploymentMode: "continuous_agents",
          agents: [
            {
              roleKey: "backend-engineer",
              title: "Backend Engineer",
              roleType: "operator",
              department: "engineering",
              headcount: 1,
              reportsToRoleKey: null,
              mandate: "Build the MVP backend.",
              justification: "The MVP is integration-heavy.",
              kpis: ["API milestones"],
              skills: ["paperclip"],
              tools: ["github"],
              modelTier: "standard",
              budgetMonthlyUsd: 700,
              provisioningInstructions: "Provision as an implementation agent.",
            },
          ],
        },
        roadmap306090: {
          day30: {
            objectives: ["Define scope"],
            deliverables: ["Architecture memo"],
            ownerRoleKeys: ["backend-engineer"],
          },
          day60: {
            objectives: ["Ship integration MVP"],
            deliverables: ["Connector alpha"],
            ownerRoleKeys: ["backend-engineer"],
          },
          day90: {
            objectives: ["Run pilots"],
            deliverables: ["Pilot dashboard"],
            ownerRoleKeys: ["backend-engineer"],
          },
        },
      }),
    }));
    mockGetProvider.mockReturnValue(providerMock);

    const roleLibrary = [
      {
        roleKey: "backend-engineer",
        title: "Backend Engineer",
        roleType: "operator",
        department: "engineering",
        mandate: "Build APIs and integrations.",
        defaultReportsToRoleKey: "cto",
        defaultSkills: ["paperclip", "nodejs-backend-patterns"],
        defaultTools: ["github", "vercel"],
        defaultModelTier: "standard",
        hiringSignals: ["API delivery"],
      },
    ];

    const res = await request(app)
      .post("/api/goals/team-assembly")
      .set("X-User-Id", "user-team-assembly-prompt")
      .send({
        companyName: "LedgerPilot",
        normalizedGoalDocument,
        prd,
        roleLibrary,
      });

    expect(res.status).toBe(200);
    expect(providerMock).toHaveBeenCalledWith(expect.stringContaining("\"title\": \"AI Bookkeeping Concierge for Shopify Brands\""));
    expect(providerMock).toHaveBeenCalledWith(expect.stringContaining("\"roleKey\": \"backend-engineer\""));
    expect(providerMock).toHaveBeenCalledWith(expect.stringContaining("Company name: LedgerPilot"));
  });
});

// ---------------------------------------------------------------------------
// POST /api/runs/file
// ---------------------------------------------------------------------------

describe("POST /api/runs/file", () => {
  it("returns 400 when templateId is missing", async () => {
    const res = await request(app)
      .post("/api/runs/file")
      .attach("file", Buffer.from("hello"), { filename: "f.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/templateId/);
  });

  it("returns 400 when file is missing", async () => {
    const res = await request(app)
      .post("/api/runs/file")
      .field("templateId", "tpl-support-bot");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/file is required/);
  });

  it("returns 404 for unknown templateId", async () => {
    const res = await request(app)
      .post("/api/runs/file")
      .field("templateId", "no-such-template")
      .attach("file", Buffer.from("hello"), { filename: "f.txt", contentType: "text/plain" });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Template not found/);
  });

  it("returns 202 with run for a valid text file", async () => {
    const res = await request(app)
      .post("/api/runs/file")
      .field("templateId", "tpl-support-bot")
      .attach("file", Buffer.from("Customer complaint about billing"), { filename: "ticket.txt", contentType: "text/plain" });
    expect(res.status).toBe(202);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe("pending");
  });

  it("returns 202 when X-User-Id is provided (resolves openaiApiKey path)", async () => {
    const res = await request(app)
      .post("/api/runs/file")
      .set("X-User-Id", "user-no-llm")
      .field("templateId", "tpl-support-bot")
      .attach("file", Buffer.from("Hello from user"), { filename: "note.txt", contentType: "text/plain" });
    expect(res.status).toBe(202);
  });

  it("returns 422 when parseFile throws an error", async () => {
    const fileParser = await import("./engine/fileParser");
    jest.spyOn(fileParser, "parseFile").mockRejectedValueOnce(new Error("corrupt file"));

    const res = await request(app)
      .post("/api/runs/file")
      .field("templateId", "tpl-support-bot")
      .attach("file", Buffer.from("corrupt data"), { filename: "bad.bin", contentType: "application/octet-stream" });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/File parsing failed/);
  });
});
