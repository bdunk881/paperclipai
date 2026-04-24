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
  deployWorkflowAsTeam,
  listTemplates,
  listControlPlaneTeams,
  getControlPlaneTeam,
  getTemplate,
  listRuns,
  getRun,
  startRun,
  type TemplateSummary,
} from "./client";
import type { WorkflowRun, WorkflowTemplate } from "../types/workflow";

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
  vi.restoreAllMocks();
  vi.spyOn(authStorage, "readStoredAuthUser").mockReturnValue(null);
});

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
