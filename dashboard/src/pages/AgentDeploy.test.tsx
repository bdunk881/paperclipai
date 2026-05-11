import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AgentDeploy, { toWorkflowCategory, buildTemplateDeploymentBlueprint } from "./AgentDeploy";
import type { AgentCatalogTemplate } from "../api/agentCatalog";

const navigateMock = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

const { getAccessTokenMock, getAgentCatalogTemplateMock, deployWorkflowAsTeamMock } = vi.hoisted(() => ({
  getAccessTokenMock: vi.fn(),
  getAgentCatalogTemplateMock: vi.fn(),
  deployWorkflowAsTeamMock: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "user@example.com", name: "User" },
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
    getAccessToken: getAccessTokenMock,
  }),
}));

vi.mock("../api/agentCatalog", () => ({
  getAgentCatalogTemplate: (...args: unknown[]) => getAgentCatalogTemplateMock(...args),
}));

vi.mock("../api/client", () => ({
  deployWorkflowAsTeam: (...args: unknown[]) => deployWorkflowAsTeamMock(...args),
}));

const fetchMock = vi.fn();

function makeTemplate(overrides: Partial<AgentCatalogTemplate> = {}): AgentCatalogTemplate {
  return {
    id: "tpl-1",
    name: "Sales Agent",
    description: "A sales agent template",
    category: "Sales",
    skills: ["email", "crm"],
    defaultModel: "claude-3",
    defaultInstructions: "Be helpful.",
    suggestedBudgetMonthlyUsd: 100,
    ...overrides,
  };
}

function makeDeployment(overrides: Partial<{ agentStepId: string }> = {}) {
  return {
    team: { id: "team-1", name: "Sales Agent" },
    agents: [{ id: "agent-1", workflowStepId: overrides.agentStepId ?? "step-agent-catalog-worker" }],
    workflow: { id: "wf-1", name: "Sales Agent", category: "sales", version: "1.0.0" },
  };
}

function renderDeploy(templateId = "tpl-1") {
  return render(
    <MemoryRouter initialEntries={[`/agents/deploy/${templateId}`]}>
      <Routes>
        <Route path="/agents/deploy/:templateId" element={<AgentDeploy />} />
      </Routes>
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Pure helper: toWorkflowCategory
// ---------------------------------------------------------------------------

describe("toWorkflowCategory", () => {
  it.each([
    ["sales", "sales"],
    ["SALES", "sales"],
    ["support", "support"],
    ["marketing", "marketing"],
    ["engineering", "engineering"],
    ["operations", "operations"],
    ["unknown-category", "operations"],
  ])("maps %s → %s", (input, expected) => {
    expect(toWorkflowCategory(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Pure helper: buildTemplateDeploymentBlueprint
// ---------------------------------------------------------------------------

describe("buildTemplateDeploymentBlueprint", () => {
  const template = makeTemplate();

  it("produces interval schedule when defaultIntervalMinutes > 0", () => {
    const bp = buildTemplateDeploymentBlueprint(template, 50, 30);
    const worker = bp.steps.find((s) => s.kind === "agent");
    expect(worker?.agentScheduleType).toBe("interval");
    expect(worker?.agentScheduleValue).toBe("30");
  });

  it("produces manual schedule when defaultIntervalMinutes = 0", () => {
    const bp = buildTemplateDeploymentBlueprint(template, 50, 0);
    const worker = bp.steps.find((s) => s.kind === "agent");
    expect(worker?.agentScheduleType).toBe("manual");
    expect(worker?.agentScheduleValue).toBeUndefined();
  });

  it("propagates category mapping through toWorkflowCategory", () => {
    const bp = buildTemplateDeploymentBlueprint(makeTemplate({ category: "Marketing" }), 0, 0);
    expect(bp.category).toBe("marketing");
  });
});

// ---------------------------------------------------------------------------
// AgentDeploy component
// ---------------------------------------------------------------------------

describe("AgentDeploy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccessTokenMock.mockResolvedValue("mock-token");
    getAgentCatalogTemplateMock.mockResolvedValue(null);
    deployWorkflowAsTeamMock.mockResolvedValue(makeDeployment());
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ connections: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  // ---- loading / not-found states ----

  it("shows loading state while template resolves", () => {
    getAgentCatalogTemplateMock.mockReturnValue(new Promise(() => {}));
    renderDeploy();
    expect(screen.getByText(/loading agent template/i)).toBeInTheDocument();
  });

  it("shows not-found state when template returns null", async () => {
    renderDeploy();
    expect(await screen.findByText(/agent template not found/i)).toBeInTheDocument();
  });

  it("shows not-found state when getAccessToken returns null on load", async () => {
    getAccessTokenMock.mockResolvedValueOnce(null);
    renderDeploy();
    expect(await screen.findByText(/agent template not found/i)).toBeInTheDocument();
  });

  // ---- success render ----

  it("renders deploy form when template loads successfully", async () => {
    getAgentCatalogTemplateMock.mockResolvedValue(makeTemplate());
    renderDeploy();
    expect(await screen.findByText(/deploy Sales Agent/i)).toBeInTheDocument();
  });

  // ---- integration status loading ----

  it("shows connection error when integration status fetch returns non-ok with error field", async () => {
    getAgentCatalogTemplateMock.mockResolvedValue(makeTemplate());
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Integration service unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      })
    );
    renderDeploy();
    await waitFor(() =>
      expect(screen.getByText(/integration service unavailable/i)).toBeInTheDocument()
    );
  });

  it("shows fallback connection error when non-ok response has no JSON error field", async () => {
    getAgentCatalogTemplateMock.mockResolvedValue(makeTemplate());
    fetchMock.mockResolvedValue(new Response("Internal Server Error", { status: 500 }));
    renderDeploy();
    await waitFor(() =>
      expect(screen.getByText(/failed to load integration/i)).toBeInTheDocument()
    );
  });

  it("shows connection error when authorizedFetch throws because token is null", async () => {
    getAgentCatalogTemplateMock.mockResolvedValue(makeTemplate());
    // first call: template load; second call: integration fetch → no token
    getAccessTokenMock
      .mockResolvedValueOnce("mock-token")
      .mockResolvedValueOnce(null);
    renderDeploy();
    await waitFor(() =>
      expect(screen.getByText(/authentication session expired/i)).toBeInTheDocument()
    );
  });

  it("shows connected provider with account label", async () => {
    getAgentCatalogTemplateMock.mockResolvedValue(makeTemplate());
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ connections: [{ provider: "google", accountLabel: "workspace@acme.com" }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    renderDeploy();
    await waitFor(() => expect(screen.getByText("workspace@acme.com")).toBeInTheDocument());
    expect(screen.getAllByText("Connected").length).toBeGreaterThanOrEqual(1);
  });

  // ---- handleDeploy ----

  it("navigates to team page with agent query on successful deploy", async () => {
    getAgentCatalogTemplateMock.mockResolvedValue(makeTemplate());
    renderDeploy();
    await screen.findByText(/deploy Sales Agent/i);

    fireEvent.submit(screen.getByRole("button", { name: /create agent/i }).closest("form")!);

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith(
        "/agents/team/team-1?agent=agent-1",
        expect.objectContaining({ state: expect.objectContaining({ message: expect.stringContaining("deployed successfully") }) })
      )
    );
  });

  it("navigates without agent query when deployed agent step id is not found", async () => {
    deployWorkflowAsTeamMock.mockResolvedValue(makeDeployment({ agentStepId: "step-other" }));
    getAgentCatalogTemplateMock.mockResolvedValue(makeTemplate());
    renderDeploy();
    await screen.findByText(/deploy Sales Agent/i);

    fireEvent.submit(screen.getByRole("button", { name: /create agent/i }).closest("form")!);

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith(
        "/agents/team/team-1",
        expect.anything()
      )
    );
  });

  it("shows deploy error for Error instance thrown by deployWorkflowAsTeam", async () => {
    deployWorkflowAsTeamMock.mockRejectedValue(new Error("Quota exceeded"));
    getAgentCatalogTemplateMock.mockResolvedValue(makeTemplate());
    renderDeploy();
    await screen.findByText(/deploy Sales Agent/i);

    fireEvent.submit(screen.getByRole("button", { name: /create agent/i }).closest("form")!);

    await waitFor(() => expect(screen.getByText("Quota exceeded")).toBeInTheDocument());
  });

  it("shows fallback deploy error for non-Error thrown by deployWorkflowAsTeam", async () => {
    deployWorkflowAsTeamMock.mockRejectedValue("string error");
    getAgentCatalogTemplateMock.mockResolvedValue(makeTemplate());
    renderDeploy();
    await screen.findByText(/deploy Sales Agent/i);

    fireEvent.submit(screen.getByRole("button", { name: /create agent/i }).closest("form")!);

    await waitFor(() => expect(screen.getByText(/failed to deploy workflow team/i)).toBeInTheDocument());
  });

  it("shows auth error on deploy when getAccessToken returns null at deploy time", async () => {
    getAgentCatalogTemplateMock.mockResolvedValue(makeTemplate());
    getAccessTokenMock
      .mockResolvedValueOnce("mock-token") // template load
      .mockResolvedValueOnce("mock-token") // integration status
      .mockResolvedValueOnce(null);         // deploy
    renderDeploy();
    await screen.findByText(/deploy Sales Agent/i);

    fireEvent.submit(screen.getByRole("button", { name: /create agent/i }).closest("form")!);

    await waitFor(() =>
      expect(screen.getByText(/authentication session expired/i)).toBeInTheDocument()
    );
  });
});
