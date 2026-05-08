import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard";

const {
  listRunsMock,
  listApprovalsMock,
  listAgentsMock,
  getAgentBudgetMock,
  getAgentHeartbeatMock,
  listAgentRunsMock,
  createTicketMock,
  requireAccessTokenMock,
} = vi.hoisted(() => ({
  listRunsMock: vi.fn(),
  listApprovalsMock: vi.fn(),
  listAgentsMock: vi.fn(),
  getAgentBudgetMock: vi.fn(),
  getAgentHeartbeatMock: vi.fn(),
  listAgentRunsMock: vi.fn(),
  createTicketMock: vi.fn(),
  requireAccessTokenMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  listRuns: listRunsMock,
  listApprovals: listApprovalsMock,
}));

vi.mock("../api/agentApi", () => ({
  listAgents: listAgentsMock,
  getAgentBudget: getAgentBudgetMock,
  getAgentHeartbeat: getAgentHeartbeatMock,
  listAgentRuns: listAgentRunsMock,
}));

vi.mock("../api/tickets", () => ({
  createTicket: createTicketMock,
}));

vi.mock("../components/RunAuditSidebar", () => ({
  RunAuditSidebar: ({ open }: { open: boolean }) => (open ? <div>Run audit open</div> : null),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "user@example.com", name: "Test User" },
    requireAccessToken: requireAccessTokenMock,
  }),
}));

describe("Dashboard", () => {
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
        output: { summary: "Homepage concept approved with three revision notes." },
        stepResults: [],
      },
      {
        id: "run-code",
        templateId: "tpl-code",
        templateName: "Frontend Build",
        status: "running",
        startedAt: "2026-04-27T12:00:00.000Z",
        input: {},
        output: {},
        stepResults: [],
      },
    ]);
    listApprovalsMock.mockResolvedValue([
      {
        id: "approval-1",
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
        metadata: { teamName: "Engineering" },
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-27T12:00:00.000Z",
      },
    ]);
    getAgentBudgetMock.mockImplementation(async (agentId: string) =>
      agentId === "agent-graphic"
        ? {
            agentId,
            userId: "user-1",
            monthlyUsd: 200,
            spentUsd: 40,
            remainingUsd: 160,
            currentPeriod: "2026-04",
          }
        : {
            agentId,
            userId: "user-1",
            monthlyUsd: 240,
            spentUsd: 120,
            remainingUsd: 120,
            currentPeriod: "2026-04",
          }
    );
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
    listAgentRunsMock.mockImplementation(async (agentId: string) => [
      {
        id: `agent-run-${agentId}`,
        agentId,
        userId: "user-1",
        status: "completed",
        summary:
          agentId === "agent-graphic" ? "Delivered the approved visual direction." : "Shipped the latest UI pass.",
        tokenUsage: 120,
        costUsd: 0.8,
        startedAt: "2026-04-27T11:00:00.000Z",
        completedAt: "2026-04-27T11:30:00.000Z",
        createdByRunId: `source-run-${agentId}`,
        createdAt: "2026-04-27T11:00:00.000Z",
      },
    ]);
    createTicketMock.mockResolvedValue({
      ticket: { id: "ticket-1" },
      updates: [],
      source: "api",
      integrationWarnings: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes the access token to live dashboard APIs", async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await screen.findByText(/Test, here is your live workspace summary/i);

    expect(requireAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(listRunsMock).toHaveBeenCalledWith(undefined, "mock-token");
    expect(listApprovalsMock).toHaveBeenCalledWith("mock-token");
    expect(listAgentsMock).toHaveBeenCalledWith("mock-token");
    expect(getAgentBudgetMock).toHaveBeenCalledTimes(2);
    expect(getAgentHeartbeatMock).toHaveBeenCalledTimes(2);
    expect(listAgentRunsMock).toHaveBeenCalledTimes(2);
  });

  it("renders the customer dashboard sections and live approval queue", async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    expect(await screen.findByText("Customer command center")).toBeInTheDocument();
    expect(screen.getByText("Execution Burndown")).toBeInTheDocument();
    expect(screen.getByText("Spend vs Budget")).toBeInTheDocument();
    expect(screen.getByText("Queued Approvals")).toBeInTheDocument();
    expect(screen.getByText("Artifact Review")).toBeInTheDocument();
    expect(screen.getByText("Approve the final ship candidate.")).toBeInTheDocument();
    expect(screen.getAllByText("Graphic Designer").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Frontend Engineer").length).toBeGreaterThan(0);
  });

  it("routes inline artifact feedback to the matched owner via ticket creation", async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await screen.findByText("Artifact Review");

    fireEvent.change(screen.getAllByPlaceholderText(/route artifact feedback/i)[0], {
      target: { value: "Tighten the headline spacing before customer review." },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /send to owner/i })[0]);

    await waitFor(() => expect(createTicketMock).toHaveBeenCalledTimes(1));
    expect(createTicketMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Artifact review: Frontend Build",
        assignees: [{ type: "agent", id: "agent-frontend", role: "primary" }],
      }),
      "mock-token"
    );
    expect(await screen.findByText(/feedback routed to Frontend Engineer/i)).toBeInTheDocument();
  });

  it("renders the error state and retries loading", async () => {
    listRunsMock.mockRejectedValueOnce(new Error("dashboard failed"));

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    expect(await screen.findByText("Customer dashboard unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText(/Test, here is your live workspace summary/i)).toBeInTheDocument();
    expect(listRunsMock).toHaveBeenCalledTimes(2);
  });
});
