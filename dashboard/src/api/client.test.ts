/**
 * Unit tests for dashboard/src/api/client.ts
 *
 * Uses vi.stubGlobal to mock the global `fetch` so no real HTTP calls are made.
 * Tests verify correct URL construction, method, headers, body serialisation,
 * and error handling for each API function.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as authStorage from "../auth/authStorage";
import {
  createLLMConfig,
  createProposalDraft,
  createTemplate,
  debugStep,
  deleteLLMConfig,
  deleteMemoryEntry,
  deployWorkflowAsTeam,
  generateTeamAssemblyPlan,
  generateWorkflow,
  getControlPlaneTeam,
  listCompanyRoleTemplates,
  getProposalJobStatus,
  getObservabilityStreamPath,
  getObservabilityThroughput,
  getMemoryStats,
  listApprovals,
  listControlPlaneTeams,
  listLLMConfigs,
  listObservabilityEvents,
  listMemoryEntries,
  listProposalContext,
  listTemplates,
  getTemplate,
  listRuns,
  getRun,
  provisionCompanyWorkspace,
  resolveApproval,
  searchMemory,
  setDefaultLLMConfig,
  startRun,
  startRunWithFile,
  writeMemoryEntry,
  type TemplateSummary,
} from "./client";
import type { WorkflowRun, WorkflowTemplate } from "../types/workflow";

const ACCESS_TOKEN = "token-123";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function mockFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })
  );
}

function mockFetchFail(status: number, errorBody: unknown = { error: "Not found" }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: async () => errorBody,
    })
  );
}

function lastFetchUrl(): string {
  const mock = vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>);
  return mock.mock.calls[0][0] as string;
}

function lastFetchOptions(): RequestInit {
  const mock = vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>);
  return (mock.mock.calls[0][1] ?? {}) as RequestInit;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.spyOn(authStorage, "readStoredAuthUser").mockReturnValue(null);
});

async function importClientWithMockMode() {
  vi.resetModules();
  vi.stubEnv("VITE_USE_MOCK", "true");
  vi.stubGlobal("fetch", vi.fn());
  return import("./client");
}

const sampleSummary: TemplateSummary = {
  id: "tpl-support-bot",
  name: "Customer Support Bot",
  description: "Test template",
  category: "support",
  version: "1.0.0",
  stepCount: 6,
  configFieldCount: 5,
};

const sampleRun: WorkflowRun = {
  id: "run-001",
  templateId: "tpl-support-bot",
  templateName: "Customer Support Bot",
  status: "completed",
  startedAt: "2024-01-01T00:00:00.000Z",
  input: {},
  stepResults: [],
};

const sampleTeam = {
  id: "team-001",
  userId: "user-001",
  name: "Support Team",
  deploymentMode: "continuous_agents" as const,
  budgetMonthlyUsd: 120,
  orchestrationEnabled: true,
  createdAt: "2026-04-23T00:00:00.000Z",
  updatedAt: "2026-04-23T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// listTemplates
// ---------------------------------------------------------------------------

describe("listTemplates", () => {
  it("calls GET /api/templates with no category param", async () => {
    mockFetch({ templates: [sampleSummary], total: 1 });
    const result = await listTemplates();
    expect(lastFetchUrl()).toBe("/api/templates");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("tpl-support-bot");
  });

  it("appends category query param when provided", async () => {
    mockFetch({ templates: [], total: 0 });
    await listTemplates("support");
    expect(lastFetchUrl()).toContain("category=support");
  });

  it("URL-encodes the category param", async () => {
    mockFetch({ templates: [], total: 0 });
    await listTemplates("sales & marketing");
    expect(lastFetchUrl()).toContain("sales%20%26%20marketing");
  });

  it("throws on non-ok response", async () => {
    mockFetchFail(500);
    await expect(listTemplates()).rejects.toThrow(/500/);
  });

  it("returns the templates array from the response", async () => {
    const templates = [sampleSummary, { ...sampleSummary, id: "tpl-lead-enrich" }];
    mockFetch({ templates, total: 2 });
    const result = await listTemplates();
    expect(result).toHaveLength(2);
  });

  it("returns mock templates without calling fetch when VITE_USE_MOCK=true", async () => {
    const client = await importClientWithMockMode();
    const result = await client.listTemplates();
    expect(result.map((template) => template.id)).toContain("tpl-support-bot");
    expect(vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getTemplate
// ---------------------------------------------------------------------------

describe("getTemplate", () => {
  it("calls GET /api/templates/:id with the correct id", async () => {
    const fullTemplate = { ...sampleSummary, steps: [], configFields: [], sampleInput: {}, expectedOutput: {} };
    mockFetch(fullTemplate);
    await getTemplate("tpl-support-bot");
    expect(lastFetchUrl()).toBe("/api/templates/tpl-support-bot");
  });

  it("URL-encodes the template id", async () => {
    mockFetch({});
    await getTemplate("tpl support bot").catch(() => {});
    expect(lastFetchUrl()).toContain("tpl%20support%20bot");
  });

  it("throws on 404 response", async () => {
    mockFetchFail(404);
    await expect(getTemplate("tpl-missing")).rejects.toThrow(/tpl-missing/);
  });

  it("returns the template object", async () => {
    const tpl: Partial<WorkflowTemplate> = {
      id: "tpl-support-bot",
      name: "Customer Support Bot",
      category: "support",
    };
    mockFetch(tpl);
    const result = await getTemplate("tpl-support-bot");
    expect(result.id).toBe("tpl-support-bot");
  });

  it("returns a mock template without calling fetch when VITE_USE_MOCK=true", async () => {
    const client = await importClientWithMockMode();
    const result = await client.getTemplate("tpl-support-bot");
    expect(result.name).toBe("Customer Support Bot");
    expect(vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe("team assembly client", () => {
  it("posts to /api/goals/team-assembly", async () => {
    mockFetch({
      schemaVersion: "2026-04-27",
      company: {
        name: "LedgerPilot",
        goal: "Build a finance workflow team",
        targetCustomer: null,
        budget: null,
        timeHorizon: null,
      },
      summary: "Lean staffing plan",
      rationale: "Keep the first team compact.",
      orgChart: { executives: [], operators: [], reportingLines: [] },
      provisioningPlan: { teamName: "LedgerPilot Launch Team", deploymentMode: "continuous_agents", agents: [] },
      roadmap306090: {
        day30: { objectives: ["Define scope"], deliverables: ["Architecture memo"], ownerRoleKeys: ["ceo"] },
        day60: { objectives: ["Ship MVP"], deliverables: ["Pilot workflow"], ownerRoleKeys: ["cto"] },
        day90: { objectives: ["Launch pilots"], deliverables: ["Pilot dashboard"], ownerRoleKeys: ["ceo"] },
      },
    });

    await generateTeamAssemblyPlan(
      {
        companyName: "LedgerPilot",
        normalizedGoalDocument: {
          sourceType: "free_text",
          goal: "Build a finance workflow team",
          targetCustomer: null,
          successMetrics: [],
          constraints: [],
          budget: null,
          timeHorizon: null,
          planReadinessThreshold: 0.7,
        },
      },
      ACCESS_TOKEN
    );

    expect(lastFetchUrl()).toBe("/api/goals/team-assembly");
    expect(lastFetchOptions().method).toBe("POST");
    expect(lastFetchOptions().headers).toMatchObject({
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    });
  });

  it("gets /api/companies/role-templates", async () => {
    mockFetch({
      roleTemplates: [],
      total: 0,
      provisioningContract: {
        schemaVersion: "2026-04-28",
        endpoint: "/api/companies",
        requiredHeaders: ["X-Paperclip-Run-Id"],
        companyFields: { required: [], optional: [] },
        agentFields: { identifierFields: ["roleTemplateId", "roleKey"], requiredOneOf: [], optional: [] },
      },
    });

    await listCompanyRoleTemplates(ACCESS_TOKEN);
    expect(lastFetchUrl()).toBe("/api/companies/role-templates");
    expect(lastFetchOptions().headers).toMatchObject({
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    });
  });

  it("posts provisioning payload to /api/companies", async () => {
    mockFetch({
      company: {
        id: "company-1",
        userId: "user-1",
        name: "LedgerPilot",
        workspaceId: "workspace-1",
        teamId: "team-1",
        idempotencyKey: "staffing-plan-1",
        budgetMonthlyUsd: 2400,
        allocatedBudgetMonthlyUsd: 2400,
        remainingBudgetMonthlyUsd: 0,
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z",
      },
      workspace: {
        id: "workspace-1",
        name: "LedgerPilot Launch Team",
        slug: "ledgerpilot",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z",
      },
      team: sampleTeam,
      agents: [],
      secretBindings: [],
      availableSkills: [],
      idempotentReplay: false,
    });

    await provisionCompanyWorkspace(
      {
        name: "LedgerPilot",
        workspaceName: "LedgerPilot Launch Team",
        idempotencyKey: "staffing-plan-1",
        budgetMonthlyUsd: 2400,
        secretBindings: { OPENAI_API_KEY: "sk-test" },
        agents: [{ roleKey: "ceo", budgetMonthlyUsd: 1200 }],
      },
      ACCESS_TOKEN,
      "run-staffing"
    );

    expect(lastFetchUrl()).toBe("/api/companies");
    expect(lastFetchOptions().method).toBe("POST");
    expect(lastFetchOptions().headers).toMatchObject({
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "X-Paperclip-Run-Id": "run-staffing",
    });
  });
});

// ---------------------------------------------------------------------------
// listRuns
// ---------------------------------------------------------------------------

describe("listRuns", () => {
  it("calls GET /api/runs without filter", async () => {
    mockFetch({ runs: [sampleRun], total: 1 });
    const result = await listRuns();
    expect(lastFetchUrl()).toBe("/api/runs");
    expect(result).toHaveLength(1);
  });

  it("appends templateId filter when provided", async () => {
    mockFetch({ runs: [], total: 0 });
    await listRuns("tpl-support-bot");
    expect(lastFetchUrl()).toContain("templateId=tpl-support-bot");
  });

  it("throws on non-ok response", async () => {
    mockFetchFail(500);
    await expect(listRuns()).rejects.toThrow(/Not found/);
  });

  it("uses the backend error payload when runs loading fails", async () => {
    mockFetchFail(401, { error: "Unauthorized" });
    await expect(listRuns()).rejects.toThrow(/Unauthorized/);
  });

  it("adds Authorization header when access token is provided", async () => {
    mockFetch({ runs: [sampleRun], total: 1 });
    await listRuns(undefined, "token-123");
    const headers = lastFetchOptions().headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token-123");
  });

  it("falls back to X-User-Id when a preview user is stored", async () => {
    vi.spyOn(authStorage, "readStoredAuthUser").mockReturnValue({
      id: "usr-qa-preview",
      email: "qa-preview@autoflow.local",
      name: "QA Preview User",
    });
    mockFetch({ runs: [sampleRun], total: 1 });
    await listRuns();
    const headers = lastFetchOptions().headers as Record<string, string>;
    expect(headers["X-User-Id"]).toBe("usr-qa-preview");
  });

  it("returns the runs array from the response", async () => {
    const runs = [sampleRun, { ...sampleRun, id: "run-002" }];
    mockFetch({ runs, total: 2 });
    const result = await listRuns();
    expect(result).toHaveLength(2);
  });

  it("returns mock runs without calling fetch when VITE_USE_MOCK=true", async () => {
    const client = await importClientWithMockMode();
    const result = await client.listRuns("tpl-support-bot");
    expect(result.every((run) => run.templateId === "tpl-support-bot")).toBe(true);
    expect(vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getRun
// ---------------------------------------------------------------------------

describe("getRun", () => {
  it("calls GET /api/runs/:id", async () => {
    mockFetch(sampleRun);
    await getRun("run-001");
    expect(lastFetchUrl()).toBe("/api/runs/run-001");
  });

  it("throws on 404 response", async () => {
    mockFetchFail(404);
    await expect(getRun("run-missing")).rejects.toThrow(/run-missing/);
  });

  it("returns the run object", async () => {
    mockFetch(sampleRun);
    const result = await getRun("run-001");
    expect(result.id).toBe("run-001");
    expect(result.status).toBe("completed");
  });

  it("returns a mock run without calling fetch when VITE_USE_MOCK=true", async () => {
    const client = await importClientWithMockMode();
    const result = await client.getRun("run-001");
    expect(result.id).toBe("run-001");
    expect(vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe("observability client helpers", () => {
  it("builds the SSE stream path with cursor and category filters", () => {
    const path = getObservabilityStreamPath({
      after: "101",
      categories: ["issue", "run"],
      limit: 25,
    });
    expect(path).toBe("/api/observability/events/stream?after=101&categories=issue%2Crun&limit=25");
  });

  it("calls the polling fallback endpoint with auth headers", async () => {
    mockFetch({ events: [], nextCursor: null, hasMore: false, generatedAt: "2026-04-28T00:00:00.000Z" });
    await listObservabilityEvents({ after: "42", categories: ["heartbeat"], limit: 10 }, ACCESS_TOKEN);
    expect(lastFetchUrl()).toBe("/api/observability/events?after=42&categories=heartbeat&limit=10");
    const headers = lastFetchOptions().headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it("requests the throughput aggregate window", async () => {
    mockFetch({
      windowHours: 24,
      generatedAt: "2026-04-28T00:00:00.000Z",
      summary: { createdCount: 2, completedCount: 1, blockedCount: 1, completionRate: 0.5 },
      buckets: [],
    });
    await getObservabilityThroughput(24, ACCESS_TOKEN);
    expect(lastFetchUrl()).toBe("/api/observability/throughput?windowHours=24");
  });
});

describe("mock workflow actions", () => {
  it("starts a mock run without calling fetch when VITE_USE_MOCK=true", async () => {
    const client = await importClientWithMockMode();
    const result = await client.startRun("tpl-support-bot", { subject: "Billing issue" });
    expect(result.templateId).toBe("tpl-support-bot");
    expect(result.status).toBe("running");
    expect(vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("returns mock LLM configs without calling fetch when VITE_USE_MOCK=true", async () => {
    const client = await importClientWithMockMode();
    const result = await client.listLLMConfigs("token-123");
    expect(result[0]?.label).toBe("OpenAI Default");
    expect(vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// startRun
// ---------------------------------------------------------------------------

describe("startRun", () => {
  it("calls POST /api/runs", async () => {
    mockFetch(sampleRun, 202);
    await startRun("tpl-support-bot", {});
    expect(lastFetchUrl()).toBe("/api/runs");
    expect(lastFetchOptions().method).toBe("POST");
  });

  it("sends Content-Type: application/json", async () => {
    mockFetch(sampleRun, 202);
    await startRun("tpl-support-bot", {});
    const headers = lastFetchOptions().headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("sends templateId, input, and config in the body", async () => {
    mockFetch(sampleRun, 202);
    const input = { ticketId: "TKT-001" };
    const config = { brandName: "Acme" };
    await startRun("tpl-support-bot", input, config);

    const body = JSON.parse(lastFetchOptions().body as string);
    expect(body.templateId).toBe("tpl-support-bot");
    expect(body.input).toEqual(input);
    expect(body.config).toEqual(config);
  });

  it("omits config from body when not provided", async () => {
    mockFetch(sampleRun, 202);
    await startRun("tpl-support-bot", {});
    const body = JSON.parse(lastFetchOptions().body as string);
    expect(body.config).toBeUndefined();
  });

  it("throws with server error message on non-ok response", async () => {
    mockFetchFail(400, { error: "templateId is required" });
    await expect(startRun("", {})).rejects.toThrow(/templateId is required/);
  });

  it("throws with status code message when error body has no error field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => { throw new Error("not json"); },
        statusText: "Service Unavailable",
      })
    );
    await expect(startRun("tpl-support-bot", {})).rejects.toThrow(/503/);
  });

  it("returns the new WorkflowRun", async () => {
    mockFetch({ ...sampleRun, status: "pending" }, 202);
    const result = await startRun("tpl-support-bot", {});
    expect(result.status).toBe("pending");
    expect(result.templateId).toBe("tpl-support-bot");
  });
});

describe("control plane client", () => {
  it("lists deployed teams with auth", async () => {
    mockFetch({ teams: [sampleTeam], total: 1 });
    const result = await listControlPlaneTeams("token-123");
    const headers = lastFetchOptions().headers as Record<string, string>;

    expect(lastFetchUrl()).toBe("/api/control-plane/teams");
    expect(headers.Authorization).toBe("Bearer token-123");
    expect(result[0].id).toBe("team-001");
  });

  it("loads a deployed team detail by id", async () => {
    mockFetch({ team: sampleTeam, agents: [], tasks: [], heartbeats: [] });
    const result = await getControlPlaneTeam("team-001", "token-123");

    expect(lastFetchUrl()).toBe("/api/control-plane/teams/team-001");
    expect(result.team.name).toBe("Support Team");
  });

  it("uses backend control-plane error payloads", async () => {
    mockFetchFail(401, { error: "Team access denied" });
    await expect(listControlPlaneTeams("token-123")).rejects.toThrow(/Team access denied/);
  });

  it("deploys a workflow as a team and forwards the run header", async () => {
    mockFetch({ team: sampleTeam, agents: [], workflow: { id: "tpl-1", name: "Support Flow", category: "support", version: "1.0.0" } }, 201);

    await deployWorkflowAsTeam(
      {
        templateId: "tpl-1",
        teamName: "Support Team",
        budgetMonthlyUsd: 120,
        defaultIntervalMinutes: 30,
      },
      "token-123",
      "run-abc"
    );

    expect(lastFetchUrl()).toBe("/api/control-plane/deployments/workflow");
    expect(lastFetchOptions().method).toBe("POST");
    const headers = lastFetchOptions().headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token-123");
    expect(headers["X-Paperclip-Run-Id"]).toBe("run-abc");
  });
});

describe("proposal builder client", () => {
  it("falls back to mock context when /api/proposals/context returns 404", async () => {
    mockFetchFail(404);
    const result = await listProposalContext(ACCESS_TOKEN);
    expect(lastFetchUrl()).toBe("/api/proposals/context");
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.templates.length).toBeGreaterThan(0);
  });

  it("posts to /api/proposals when creating a draft", async () => {
    mockFetch({ jobId: "job-123", status: "queued" }, 202);
    await createProposalDraft({ crmRecordIds: ["crm-1"], templateId: "tpl-1" }, ACCESS_TOKEN);
    expect(lastFetchUrl()).toBe("/api/proposals");
    expect(lastFetchOptions().method).toBe("POST");
  });

  it("falls back to a mock completed job when proposal polling returns 404", async () => {
    mockFetchFail(404);
    const result = await getProposalJobStatus("job-123", ACCESS_TOKEN);
    expect(lastFetchUrl()).toBe("/api/proposals/job-123");
    expect(result.status).toBe("completed");
    expect(result.draft?.title).toBeTruthy();
  });
});

describe("LLM config APIs", () => {
  it("lists configs with auth header when provided", async () => {
    mockFetch({
      configs: [
        {
          id: "cfg_1",
          label: "Primary",
          provider: "openai",
          model: "gpt-4o",
          isDefault: true,
          maskedApiKey: "sk-...1234",
          createdAt: "2026-04-22T00:00:00.000Z",
        },
      ],
    });

    const result = await listLLMConfigs("token-123");
    expect(result).toHaveLength(1);
    expect(lastFetchUrl()).toBe("/api/llm-configs");
    expect((lastFetchOptions().headers as Record<string, string>).Authorization).toBe("Bearer token-123");
  });

  it("creates, defaults, and deletes LLM configs", async () => {
    mockFetch({
      id: "cfg_1",
      label: "Primary",
      provider: "openai",
      model: "gpt-4o",
      isDefault: false,
      maskedApiKey: "sk-...1234",
      createdAt: "2026-04-22T00:00:00.000Z",
    });
    await createLLMConfig({
      label: "Primary",
      provider: "openai",
      model: "gpt-4o",
      apiKey: "sk-test",
    }, ACCESS_TOKEN);
    expect(lastFetchUrl()).toBe("/api/llm-configs");
    expect(lastFetchOptions().method).toBe("POST");

    mockFetch({
      id: "cfg_1",
      label: "Primary",
      provider: "openai",
      model: "gpt-4o",
      isDefault: true,
      maskedApiKey: "sk-...1234",
      createdAt: "2026-04-22T00:00:00.000Z",
    });
    await setDefaultLLMConfig("cfg_1", ACCESS_TOKEN);
    expect(lastFetchUrl()).toBe("/api/llm-configs/cfg_1/default");
    expect(lastFetchOptions().method).toBe("PATCH");

    mockFetch({}, 204);
    await deleteLLMConfig("cfg_1", ACCESS_TOKEN);
    expect(lastFetchUrl()).toBe("/api/llm-configs/cfg_1");
    expect(lastFetchOptions().method).toBe("DELETE");
  });

  it("surfaces server errors for create and delete failures", async () => {
    mockFetchFail(400, { error: "API key required" });
    await expect(
      createLLMConfig({
        label: "Primary",
        provider: "openai",
        model: "gpt-4o",
        apiKey: "",
      }, ACCESS_TOKEN)
    ).rejects.toThrow(/API key required/);

    mockFetchFail(500);
    await expect(deleteLLMConfig("cfg_1", ACCESS_TOKEN)).rejects.toThrow(/500/);
  });
});

describe("template and workflow helpers", () => {
  it("creates templates and generates workflow steps", async () => {
    mockFetch({
      id: "tpl_new",
      name: "New Template",
      description: "desc",
      category: "support",
      steps: [],
      configFields: [],
      sampleInput: {},
      expectedOutput: {},
      version: "1.0.0",
    });

    await createTemplate({
      name: "New Template",
      description: "desc",
      category: "support",
      steps: [],
      configFields: [],
      sampleInput: {},
      expectedOutput: {},
      version: "1.0.0",
    });
    expect(lastFetchUrl()).toBe("/api/templates");
    expect(lastFetchOptions().method).toBe("POST");

    mockFetch({ steps: [{ id: "step_1", type: "prompt", name: "Prompt", config: {} }] });
    const steps = await generateWorkflow("build a workflow", "cfg_1");
    expect(steps).toHaveLength(1);
    expect(lastFetchUrl()).toBe("/api/workflows/generate");
  });

  it("posts multipart file runs and debug requests", async () => {
    mockFetch(sampleRun, 202);
    await startRunWithFile("tpl-support-bot", new File(["hello"], "input.txt"), "user-1");
    const options = lastFetchOptions();
    expect(lastFetchUrl()).toBe("/api/runs/file");
    expect(options.method).toBe("POST");
    expect((options.headers as Record<string, string>)["X-User-Id"]).toBe("user-1");
    expect(options.body).toBeInstanceOf(FormData);

    mockFetch({ explanation: "It failed", suggestion: "Retry" });
    const debug = await debugStep("step-1", "boom", { output: true });
    expect(debug.suggestion).toBe("Retry");
    expect(lastFetchUrl()).toBe("/api/debug/step");
  });

  it("surfaces fallback error messages for workflow helpers", async () => {
    mockFetchFail(500);
    await expect(generateWorkflow("build")).rejects.toThrow(/Not found/);

    mockFetchFail(422, { error: "Cannot debug this step" });
    await expect(debugStep("step-1", "boom", {})).rejects.toThrow(/Cannot debug this step/);
  });
});

describe("memory APIs", () => {
  it("lists, searches, writes, deletes, and reads stats with user headers", async () => {
    mockFetch({
      entries: [
        {
          id: "mem_1",
          userId: "user-1",
          key: "alpha",
          text: "Alpha memory",
          createdAt: "2026-04-22T00:00:00.000Z",
          updatedAt: "2026-04-22T00:00:00.000Z",
        },
      ],
    });
    const entries = await listMemoryEntries(ACCESS_TOKEN, "user-1", "workflow 1");
    expect(entries).toHaveLength(1);
    expect(lastFetchUrl()).toContain("/api/memory?workflowId=workflow%201");
    expect((lastFetchOptions().headers as Record<string, string>)["X-User-Id"]).toBe("user-1");
    expect((lastFetchOptions().headers as Record<string, string>).Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);

    mockFetch({
      results: [
        {
          entry: {
            id: "mem_1",
            userId: "user-1",
            key: "alpha",
            text: "Alpha memory",
            createdAt: "2026-04-22T00:00:00.000Z",
            updatedAt: "2026-04-22T00:00:00.000Z",
          },
          score: 0.91,
        },
      ],
    });
    const results = await searchMemory("alpha beta", ACCESS_TOKEN, "user-1", "agent-7");
    expect(results[0].score).toBe(0.91);
    expect(lastFetchUrl()).toContain("/api/memory/search?q=alpha+beta&agentId=agent-7");

    mockFetch({
      id: "mem_1",
      userId: "user-1",
      key: "alpha",
      text: "Alpha memory",
      createdAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:00:00.000Z",
    });
    await writeMemoryEntry({ key: "alpha", text: "Alpha memory" }, ACCESS_TOKEN, "user-1");
    expect(lastFetchUrl()).toBe("/api/memory");
    expect(lastFetchOptions().method).toBe("POST");

    mockFetch({}, 204);
    await deleteMemoryEntry("mem_1", ACCESS_TOKEN, "user-1");
    expect(lastFetchUrl()).toBe("/api/memory/mem_1");
    expect(lastFetchOptions().method).toBe("DELETE");

    mockFetch({ totalEntries: 3, totalBytes: 100, workflowCount: 2 });
    const stats = await getMemoryStats(ACCESS_TOKEN, "user-1");
    expect(stats.totalEntries).toBe(3);
    expect(lastFetchUrl()).toBe("/api/memory/stats");
  });

  it("handles write failures and ignores 404 deletes", async () => {
    mockFetchFail(400, { error: "Key is required" });
    await expect(writeMemoryEntry({ key: "", text: "x" }, ACCESS_TOKEN)).rejects.toThrow(/Key is required/);

    mockFetchFail(404);
    await expect(deleteMemoryEntry("missing", ACCESS_TOKEN)).resolves.toBeUndefined();

    mockFetchFail(500);
    await expect(deleteMemoryEntry("broken", ACCESS_TOKEN)).rejects.toThrow(/500/);
  });
});

describe("approvals APIs", () => {
  it("lists approvals with optional filters and resolves decisions", async () => {
    mockFetch({
      approvals: [
        {
          id: "approval_1",
          runId: "run_1",
          templateName: "Template",
          stepId: "step_1",
          stepName: "Approve",
          assignee: "user-1",
          message: "Need approval",
          timeoutMinutes: 15,
          requestedAt: "2026-04-22T00:00:00.000Z",
          status: "pending",
        },
      ],
    });

    const approvals = await listApprovals(ACCESS_TOKEN, "pending");
    expect(approvals).toHaveLength(1);
    expect(lastFetchUrl()).toContain("/api/approvals?status=pending");

    mockFetch({}, 204);
    await resolveApproval("approval_1", "approved", ACCESS_TOKEN, "Looks good");
    expect(lastFetchUrl()).toBe("/api/approvals/approval_1/resolve");
    expect(lastFetchOptions().method).toBe("POST");
  });

  it("returns mock approvals without calling fetch when VITE_USE_MOCK=true", async () => {
    const { listApprovals: listApprovalsInMockMode } = await importClientWithMockMode();
    const approvals = await listApprovalsInMockMode(ACCESS_TOKEN, "pending");

    expect(approvals).toEqual([]);
    expect(vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("throws on approvals failures", async () => {
    mockFetchFail(503);
    await expect(listApprovals(ACCESS_TOKEN)).rejects.toThrow(/503/);

    mockFetchFail(400, { error: "Decision is required" });
    await expect(resolveApproval("approval_1", "rejected", ACCESS_TOKEN)).rejects.toThrow(/Decision is required/);
  });
});
