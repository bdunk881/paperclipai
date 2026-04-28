import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ExecutionLogs from "./ExecutionLogs";

const { getObservabilityMock, getAccessTokenMock } = vi.hoisted(() => ({
  getObservabilityMock: vi.fn(),
  getAccessTokenMock: vi.fn(),
}));

vi.mock("../api/observability", () => ({
  getObservability: (...args: unknown[]) => getObservabilityMock(...args),
  getObservabilityExportUrl: () => "/api/observability?format=csv",
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

describe("ExecutionLogs", () => {
  beforeEach(() => {
    getObservabilityMock.mockReset();
    getAccessTokenMock.mockReset();
    getAccessTokenMock.mockResolvedValue("token-123");
  });

  it("loads traces and filters them by status", async () => {
    getObservabilityMock.mockResolvedValue({
      records: [
        {
          id: "run-1:step-1",
          runId: "run-1",
          templateId: "tpl-1",
          templateName: "Customer Intake",
          stepId: "step-1",
          stepName: "Enrich lead",
          stepKind: "mcp",
          status: "failure",
          startedAt: "2026-04-22T00:00:00.000Z",
          completedAt: "2026-04-22T00:00:05.000Z",
          durationMs: 1200,
          costUsd: 0.42,
          reasoningTrace: "Tool call retried after throttling.",
          toolCalls: [
            {
              timestamp: "2026-04-22T00:00:01.000Z",
              toolType: "mcp",
              toolName: "crm.lookup",
              input: { customerId: "cust-1" },
              output: { retryable: false },
            },
          ],
          agentId: "agent-1",
          agentName: "Closer",
          taskId: "task-1",
          taskTitle: "Handle lead enrichment",
          executionId: "exec-1",
        },
        {
          id: "run-2:step-2",
          runId: "run-2",
          templateId: "tpl-2",
          templateName: "Renewal Monitor",
          stepId: "step-2",
          stepName: "Watch renewals",
          stepKind: "agent",
          status: "running",
          startedAt: "2026-04-22T01:00:00.000Z",
          durationMs: 0,
          costUsd: 0,
          reasoningTrace: "manager slot 0: investigating backlog",
          toolCalls: [],
          agentId: "agent-2",
          agentName: "Monitor",
          taskId: "task-2",
          taskTitle: "Watch renewals",
          executionId: "exec-2",
        },
      ],
      total: 2,
      filters: {
        agents: [
          { id: "agent-1", name: "Closer" },
          { id: "agent-2", name: "Monitor" },
        ],
        tasks: [
          { id: "task-1", title: "Handle lead enrichment" },
          { id: "task-2", title: "Watch renewals" },
        ],
      },
      aggregates: {
        totalCostUsd: 0.42,
        perAgent: [],
        perTask: [],
      },
    });

    render(<ExecutionLogs />);

    expect(screen.getByText(/loading execution logs/i)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Enrich lead" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Watch renewals" })).toBeInTheDocument();

    await waitFor(() => {
      expect(getObservabilityMock).toHaveBeenCalledWith("token-123", {
        agentId: undefined,
        taskId: undefined,
        search: undefined,
      });
    });

    fireEvent.click(screen.getAllByRole("button", { name: /show tool audit details/i })[0]);
    expect(screen.getAllByText(/crm.lookup/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "running" }));
    expect(screen.getByRole("heading", { name: "Watch renewals" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Enrich lead" })).not.toBeInTheDocument();
  });

  it("shows the backend error when observability loading fails", async () => {
    getObservabilityMock.mockRejectedValue(new Error("Observability fetch failed"));

    render(<ExecutionLogs />);

    expect(await screen.findByText("Observability fetch failed")).toBeInTheDocument();
  });
});
