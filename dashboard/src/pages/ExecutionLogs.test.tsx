import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ExecutionLogs from "./ExecutionLogs";

const { listRunsMock, debugStepMock, getAccessTokenMock } = vi.hoisted(() => ({
  listRunsMock: vi.fn(),
  debugStepMock: vi.fn(),
  getAccessTokenMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  listRuns: (...args: unknown[]) => listRunsMock(...args),
  debugStep: (...args: unknown[]) => debugStepMock(...args),
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
    listRunsMock.mockReset();
    debugStepMock.mockReset();
    getAccessTokenMock.mockReset();
    getAccessTokenMock.mockResolvedValue("token-123");
  });

  it("loads runs, filters them, and explains a failed step", async () => {
    listRunsMock.mockResolvedValue([
      {
        id: "run-1",
        templateName: "Customer Intake",
        status: "failed",
        startedAt: "2026-04-22T00:00:00.000Z",
        completedAt: "2026-04-22T00:00:05.000Z",
        stepResults: [
          {
            stepId: "step-1",
            stepName: "Enrich lead",
            status: "failed",
            durationMs: 1200,
            output: {
              kind: "mcp",
              input: { customerId: "cust-1" },
              output: { retryable: false },
            },
            error: "Rate limit exceeded",
          },
        ],
      },
      {
        id: "run-2",
        templateName: "Renewal Monitor",
        status: "running",
        startedAt: "2026-04-22T01:00:00.000Z",
        completedAt: null,
        stepResults: [
          {
            stepId: "step-2",
            stepName: "Watch renewals",
            status: "running",
            durationMs: 0,
            output: {
              kind: "watcher",
              input: {},
              output: {},
            },
          },
        ],
      },
    ]);
    debugStepMock.mockResolvedValue({
      explanation: "The provider throttled this request because the quota is exhausted.",
      suggestion: "Retry later",
    });

    render(<ExecutionLogs />);

    expect(screen.getByText(/loading execution logs/i)).toBeInTheDocument();

    expect(await screen.findByText("Customer Intake")).toBeInTheDocument();
    await waitFor(() => {
      expect(listRunsMock).toHaveBeenCalledWith(undefined, "token-123");
    });
    expect(screen.getByText("Renewal Monitor")).toBeInTheDocument();
    expect(screen.getByText(/live data/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Customer Intake"));
    fireEvent.click(screen.getByText("Enrich lead"));
    fireEvent.click(screen.getByRole("button", { name: /explain error with ai/i }));

    await waitFor(() => {
      expect(debugStepMock).toHaveBeenCalledWith("step-1", "Rate limit exceeded", { retryable: false });
    });

    expect(
      await screen.findByText(/provider throttled this request because the quota is exhausted/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "running" }));

    expect(screen.getByText("Renewal Monitor")).toBeInTheDocument();
    expect(screen.queryByText("Customer Intake")).not.toBeInTheDocument();
  });

  it("shows the backend error when run loading fails", async () => {
    listRunsMock.mockRejectedValue(new Error("Run fetch failed"));

    render(<ExecutionLogs />);

    expect(await screen.findByText("Run fetch failed")).toBeInTheDocument();
  });
});
