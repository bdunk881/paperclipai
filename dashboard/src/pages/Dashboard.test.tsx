import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard";
import type {
  ObservabilityEvent,
  ObservabilityFeedPage,
  ObservabilityThroughputSnapshot,
} from "../api/observability";

const {
  createTicketMock,
  getAgentBudgetMock,
  getAgentHeartbeatMock,
  getObservabilityThroughputMock,
  listAgentRunsMock,
  listAgentsMock,
  listApprovalsMock,
  listObservabilityEventsMock,
  listRunsMock,
  requireAccessTokenMock,
  streamObservabilityEventsMock,
  accessModeMock,
} = vi.hoisted(() => ({
  createTicketMock: vi.fn(),
  getAgentBudgetMock: vi.fn(),
  getAgentHeartbeatMock: vi.fn(),
  getObservabilityThroughputMock: vi.fn(),
  listAgentRunsMock: vi.fn(),
  listAgentsMock: vi.fn(),
  listApprovalsMock: vi.fn(),
  listObservabilityEventsMock: vi.fn(),
  listRunsMock: vi.fn(),
  requireAccessTokenMock: vi.fn(),
  streamObservabilityEventsMock: vi.fn(),
  accessModeMock: vi.fn(),
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

vi.mock("../api/observability", () => ({
  getObservabilityThroughput: getObservabilityThroughputMock,
  listObservabilityEvents: listObservabilityEventsMock,
  streamObservabilityEvents: streamObservabilityEventsMock,
}));

vi.mock("../api/tickets", () => ({
  createTicket: createTicketMock,
}));

vi.mock("../components/RunAuditSidebar", () => ({
  RunAuditSidebar: ({ open }: { open: boolean }) => (open ? <div>Run audit open</div> : null),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    accessMode: accessModeMock(),
    user: { id: "user-1", email: "user@example.com", name: "Test User" },
    getAccessToken: vi.fn(),
    requireAccessToken: requireAccessTokenMock,
  }),
}));

const sampleEvents: ObservabilityEvent[] = [
  {
    id: "evt-2",
    sequence: "2",
    userId: "user-1",
    category: "alert",
    type: "alert.raised",
    actor: { type: "agent", id: "agent-2", label: "Routing Watcher" },
    subject: { type: "task", id: "task-9", label: "Signal drift alert" },
    summary: "Critical alert raised for execution latency.",
    payload: {},
    occurredAt: "2026-04-28T20:10:00.000Z",
  },
  {
    id: "evt-1",
    sequence: "1",
    userId: "user-1",
    category: "run",
    type: "run.started",
    actor: { type: "run", id: "run-1", label: "Lead intake run" },
    subject: { type: "execution", id: "exec-1", label: "Lead intake execution" },
    summary: "Lead intake workflow started.",
    payload: {},
    occurredAt: "2026-04-28T20:00:00.000Z",
  },
];

const sampleFeedPage: ObservabilityFeedPage = {
  events: sampleEvents,
  nextCursor: "2",
  hasMore: false,
  generatedAt: "2026-04-28T20:10:00.000Z",
};

const sampleThroughput: ObservabilityThroughputSnapshot = {
  windowHours: 24,
  generatedAt: "2026-04-28T20:10:00.000Z",
  summary: {
    createdCount: 8,
    completedCount: 6,
    blockedCount: 1,
    completionRate: 0.75,
  },
  buckets: [
    { bucketStart: "2026-04-28T14:00:00.000Z", createdCount: 1, completedCount: 1, blockedCount: 0 },
    { bucketStart: "2026-04-28T15:00:00.000Z", createdCount: 2, completedCount: 1, blockedCount: 0 },
    { bucketStart: "2026-04-28T16:00:00.000Z", createdCount: 0, completedCount: 1, blockedCount: 0 },
    { bucketStart: "2026-04-28T17:00:00.000Z", createdCount: 2, completedCount: 1, blockedCount: 1 },
    { bucketStart: "2026-04-28T18:00:00.000Z", createdCount: 1, completedCount: 1, blockedCount: 0 },
    { bucketStart: "2026-04-28T19:00:00.000Z", createdCount: 1, completedCount: 0, blockedCount: 0 },
    { bucketStart: "2026-04-28T20:00:00.000Z", createdCount: 1, completedCount: 1, blockedCount: 0 },
    { bucketStart: "2026-04-28T21:00:00.000Z", createdCount: 0, completedCount: 0, blockedCount: 0 },
  ],
};

describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    accessModeMock.mockReturnValue("authenticated");
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
    listObservabilityEventsMock.mockResolvedValue(sampleFeedPage);
    getObservabilityThroughputMock.mockResolvedValue(sampleThroughput);
    streamObservabilityEventsMock.mockImplementation(
      async (
        _accessToken: string,
        options: { onReady?: (event: { nextCursor: string | null; replayed: number; generatedAt: string }) => void }
      ) => {
        options.onReady?.({
          nextCursor: "2",
          replayed: 0,
          generatedAt: "2026-04-28T20:10:00.000Z",
        });
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("loads customer dashboard and observability data with the access token", async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await screen.findByText(/Test, your company is live/i);
    expect(await screen.findByText("Critical alert raised for execution latency.")).toBeInTheDocument();

    expect(requireAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(listRunsMock).toHaveBeenCalledWith(undefined, "mock-token");
    expect(listApprovalsMock).toHaveBeenCalledWith("mock-token");
    expect(listAgentsMock).toHaveBeenCalledWith("mock-token");
    expect(getAgentBudgetMock).toHaveBeenCalledTimes(2);
    expect(getAgentHeartbeatMock).toHaveBeenCalledTimes(2);
    expect(listAgentRunsMock).toHaveBeenCalledTimes(2);
    expect(listObservabilityEventsMock).toHaveBeenCalledWith("mock-token", {
      categories: undefined,
      limit: 20,
    });
    expect(getObservabilityThroughputMock).toHaveBeenCalledWith("mock-token", 24);
    expect(streamObservabilityEventsMock).toHaveBeenCalledWith(
      "mock-token",
      expect.objectContaining({
        after: "2",
        categories: undefined,
        limit: 100,
      })
    );
  });

  it("renders the command center sections alongside observability panels", async () => {
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
    expect(screen.getByText("Observability Cockpit")).toBeInTheDocument();
    expect(screen.getByText("Throughput over the last 24 hours")).toBeInTheDocument();
    expect(screen.getByText("Activity updates as they happen")).toBeInTheDocument();
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

  it("reloads observability when filters or time range controls change", async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await screen.findByText("Activity updates as they happen");

    fireEvent.click(screen.getByRole("button", { name: "Alerts" }));
    await waitFor(() => {
      expect(listObservabilityEventsMock).toHaveBeenLastCalledWith("mock-token", {
        categories: ["alert"],
        limit: 20,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "6h" }));
    await waitFor(() => {
      expect(getObservabilityThroughputMock).toHaveBeenLastCalledWith("mock-token", 6);
    });
  });

  it("shows a reconnecting transport state when the live stream fails", async () => {
    streamObservabilityEventsMock.mockRejectedValue(new Error("stream offline"));

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await screen.findByText("Critical alert raised for execution latency.");

    await waitFor(() => {
      expect(screen.getByText("Recovering")).toBeInTheDocument();
      expect(screen.getByText(/reconnecting to live stream/i)).toBeInTheDocument();
    });
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
    expect(await screen.findByText(/Test, your company is live/i)).toBeInTheDocument();
    expect(listRunsMock).toHaveBeenCalledTimes(2);
  });

  it("renders preview access without calling bearer-protected dashboard APIs", async () => {
    accessModeMock.mockReturnValue("preview");

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Test, your company is live/i)).toBeInTheDocument();
    expect(screen.getByText("Artifact Review")).toBeInTheDocument();
    expect(requireAccessTokenMock).not.toHaveBeenCalled();
    expect(listRunsMock).not.toHaveBeenCalled();
    expect(listAgentsMock).not.toHaveBeenCalled();
  });
});
