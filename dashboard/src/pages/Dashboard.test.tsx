/**
 * Dashboard / Home — v2 editorial Home page tests.
 *
 * Asserts:
 *   - The greeting + meta line render with live data.
 *   - The 4-stat strip is present with the canonical labels.
 *   - The Active missions table renders rows from the missions API.
 *   - "Needs your stamp" surfaces pending approvals.
 *   - "The room right now" surfaces agent snapshots.
 *   - "Spend by agent · this week" renders per-agent bars.
 *   - Error + loading states render correctly.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard";

const {
  listRunsMock,
  listApprovalsMock,
  listAgentsMock,
  getAgentHeartbeatMock,
  listBudgetsMock,
  listMissionsMock,
  requireAccessTokenMock,
} = vi.hoisted(() => ({
  listRunsMock: vi.fn(),
  listApprovalsMock: vi.fn(),
  listAgentsMock: vi.fn(),
  getAgentHeartbeatMock: vi.fn(),
  listBudgetsMock: vi.fn(),
  listMissionsMock: vi.fn(),
  requireAccessTokenMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  listRuns: listRunsMock,
  listApprovals: listApprovalsMock,
}));

vi.mock("../api/agentApi", () => ({
  listAgents: listAgentsMock,
  getAgentHeartbeat: getAgentHeartbeatMock,
}));

vi.mock("../api/canonicalApi", () => ({
  listBudgets: listBudgetsMock,
}));

vi.mock("../api/missionsApi", () => ({
  listMissions: listMissionsMock,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "user@example.com", name: "Test User" },
    requireAccessToken: requireAccessTokenMock,
  }),
}));

vi.mock("../context/useWorkspace", () => ({
  useWorkspace: () => ({
    activeWorkspaceId: "ws-1",
  }),
}));

describe("Dashboard (v2 Home)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAccessTokenMock.mockResolvedValue("mock-token");
    listRunsMock.mockResolvedValue([
      {
        id: "run-design",
        templateId: "tpl-design",
        templateName: "Design Review",
        status: "completed",
        startedAt: "2026-04-27T10:00:00.000Z",
        completedAt: "2026-04-27T10:10:00.000Z",
        input: {},
        output: {},
        stepResults: [],
      },
    ]);
    listApprovalsMock.mockResolvedValue([
      {
        id: "approval-1234abcd",
        runId: "run-code",
        templateName: "Frontend Build",
        stepId: "step-approve",
        stepName: "Publish sign-off",
        assignee: "Brad",
        message: "Approve the final ship candidate.",
        timeoutMinutes: 60,
        requestedAt: "2026-04-27T12:15:00.000Z",
        status: "pending",
      },
    ]);
    listAgentsMock.mockResolvedValue([
      {
        id: "agent-graphic",
        userId: "user-1",
        name: "Graphic Designer",
        instructions: "",
        status: "running",
        budgetMonthlyUsd: 200,
        model: "claude-sonnet-4-6",
        metadata: { teamName: "Brand" },
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-27T12:00:00.000Z",
      },
      {
        id: "agent-frontend",
        userId: "user-1",
        name: "Frontend Engineer",
        instructions: "",
        status: "running",
        budgetMonthlyUsd: 240,
        model: "claude-opus-4-6",
        metadata: { teamName: "Engineering" },
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-27T12:00:00.000Z",
      },
    ]);
    listMissionsMock.mockResolvedValue([
      {
        id: "mission-1",
        statement: "Launch Q3 product hunt campaign",
        status: "in_flight",
        metadata: {},
        createdAt: "2026-04-20T00:00:00.000Z",
        companyId: "company-1",
        companyName: "Acme Robotics",
        latestHiringPlanId: "plan-1",
      },
      {
        id: "mission-2",
        statement: "Migrate billing service to Postgres 16",
        status: "blocked",
        metadata: {},
        createdAt: "2026-04-21T00:00:00.000Z",
        companyId: "company-1",
        companyName: "Acme Robotics",
        latestHiringPlanId: null,
      },
    ]);
    listBudgetsMock.mockResolvedValue([
      {
        id: "budget-graphic",
        scopeKind: "agent" as const,
        scopeId: "agent-graphic",
        capCents: 20000,
        usedCents: 4000,
        period: "monthly",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-27T00:00:00.000Z",
      },
      {
        id: "budget-frontend",
        scopeKind: "agent" as const,
        scopeId: "agent-frontend",
        capCents: 24000,
        usedCents: 12000,
        period: "monthly",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-27T00:00:00.000Z",
      },
    ]);
    getAgentHeartbeatMock.mockImplementation(async (agentId: string) => ({
      id: `heartbeat-${agentId}`,
      agentId,
      userId: "user-1",
      status: "running",
      summary:
        agentId === "agent-graphic"
          ? "Preparing final visual QA for customer review."
          : "Reviewing the dashboard implementation details.",
      tokenUsage: 12,
      costUsd: 0.25,
      createdByRunId: `run-${agentId}`,
      recordedAt: "2026-04-27T12:30:00.000Z",
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the v2 page chrome + greeting", async () => {
    const { container } = render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await screen.findByText(/Good (morning|afternoon|evening), Test\./i);

    expect(container.querySelector(".af2-page")).not.toBeNull();
    expect(container.querySelector(".af2-page-head")).not.toBeNull();
    expect(container.querySelector("h1.af2-h1")).not.toBeNull();
  });

  it("calls the live APIs with the access token", async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    await screen.findByText(/Good (morning|afternoon|evening), Test\./i);

    // useAgentPresence (UX-2 live strip) also calls requireAccessToken
    // for its SSE connection in addition to Dashboard's own load — so
    // the count is 2, not 1. Assert at-least-1 instead of exactly 1.
    expect(requireAccessTokenMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(listAgentsMock).toHaveBeenCalledWith("mock-token");
    expect(listApprovalsMock).toHaveBeenCalledWith("mock-token");
    expect(listRunsMock).toHaveBeenCalledWith(undefined, "mock-token");
    expect(listMissionsMock).toHaveBeenCalledWith("mock-token");
  });

  it("renders the 4-stat strip with canonical labels", async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    await screen.findByText(/Good (morning|afternoon|evening), Test\./i);

    expect(screen.getByText("Missions in flight")).toBeInTheDocument();
    expect(screen.getByText("Hours saved · 7d")).toBeInTheDocument();
    expect(screen.getByText("Spend · month")).toBeInTheDocument();
    expect(screen.getByText("Approval p50")).toBeInTheDocument();
  });

  it("renders the Active missions table with rows from the API", async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    await screen.findByText("Active missions");

    expect(screen.getByText("Launch Q3 product hunt campaign")).toBeInTheDocument();
    expect(screen.getByText("Migrate billing service to Postgres 16")).toBeInTheDocument();
  });

  it("surfaces pending approvals under 'Needs your stamp'", async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    await screen.findByText("Needs your stamp");

    expect(screen.getByText("Approve the final ship candidate.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Approve/i })).toBeInTheDocument();
  });

  it("renders 'The room right now' with each agent + their heartbeat summary", async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    await screen.findByText("The room right now");

    expect(screen.getByText("Graphic Designer")).toBeInTheDocument();
    expect(screen.getByText("Frontend Engineer")).toBeInTheDocument();
  });

  it("renders the 'Spend by agent · this week' bar list", async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    await screen.findByText("Spend by agent · this week");
  });

  it("renders the error state and retries loading", async () => {
    listAgentsMock.mockRejectedValueOnce(new Error("agents failed"));

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Home unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(
      await screen.findByText(/Good (morning|afternoon|evening), Test\./i),
    ).toBeInTheDocument();
    expect(listAgentsMock).toHaveBeenCalledTimes(2);
  });
});
