import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RunMonitor from "./RunMonitor";

const listRunsMock = vi.fn();
const listControlPlaneTeamsMock = vi.fn();
const getControlPlaneTeamMock = vi.fn();
const debugStepMock = vi.fn();
const getAccessTokenMock = vi.fn();
const requireAccessTokenMock = vi.fn();

vi.mock("../api/client", () => ({
  listRuns: (...args: unknown[]) => listRunsMock(...args),
  listControlPlaneTeams: (...args: unknown[]) => listControlPlaneTeamsMock(...args),
  getControlPlaneTeam: (...args: unknown[]) => getControlPlaneTeamMock(...args),
  debugStep: (...args: unknown[]) => debugStepMock(...args),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    getAccessToken: getAccessTokenMock,
    requireAccessToken: requireAccessTokenMock,
  }),
}));

function renderRunMonitor() {
  return render(
    <MemoryRouter>
      <RunMonitor />
    </MemoryRouter>
  );
}

describe("RunMonitor", () => {
  beforeEach(() => {
    listRunsMock.mockReset();
    listControlPlaneTeamsMock.mockReset();
    getControlPlaneTeamMock.mockReset();
    debugStepMock.mockReset();
    getAccessTokenMock.mockReset();
    requireAccessTokenMock.mockReset();
    getAccessTokenMock.mockResolvedValue("token-123");
    requireAccessTokenMock.mockResolvedValue("token-123");
    listControlPlaneTeamsMock.mockResolvedValue([]);
    getControlPlaneTeamMock.mockResolvedValue(null);
  });

  it("loads authenticated runs, separates active and recent runs, and debugs a failed step", async () => {
    listRunsMock.mockResolvedValue([
      {
        id: "run-completed",
        templateId: "tpl-2",
        templateName: "Renewal Monitor",
        status: "completed",
        startedAt: "2026-04-22T08:00:00.000Z",
        completedAt: "2026-04-22T08:00:30.000Z",
        input: {},
        output: {},
        stepResults: [
          {
            stepId: "step-completed",
            stepName: "Publish update",
            status: "success",
            output: { ok: true },
            durationMs: 300,
          },
        ],
      },
      {
        id: "run-awaiting",
        templateId: "tpl-1",
        templateName: "Customer Intake",
        status: "awaiting_approval",
        startedAt: "2026-04-22T09:00:00.000Z",
        input: {},
        output: {},
        stepResults: [
          {
            stepId: "step-failure",
            stepName: "Review customer record",
            status: "failure",
            durationMs: 1200,
            error: "Quota exhausted",
            output: {
              retryable: false,
              raw: { provider: "openai" },
            },
            agentSlotResults: [
              {
                slotIndex: 1,
                status: "success",
                output: { verdict: "approve" },
                durationMs: 450,
                messages: [
                  {
                    from: "manager",
                    slotIndex: 1,
                    content: "Check account history",
                    timestamp: "2026-04-22T09:00:01.000Z",
                  },
                  {
                    from: "worker",
                    slotIndex: 1,
                    content: "History checked",
                    timestamp: "2026-04-22T09:00:02.000Z",
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    debugStepMock.mockResolvedValue({
      explanation: "The provider rejected the request because usage is capped.",
      suggestion: "Switch to a fallback provider.",
    });

    renderRunMonitor();

    expect(await screen.findByText("Customer Intake")).toBeInTheDocument();

    await waitFor(() => {
      expect(listRunsMock).toHaveBeenCalledWith(undefined, "token-123");
    });

    expect(screen.getByText(/active runs \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/recently completed \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/run paused — waiting for human approval/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /review in approvals/i })).toHaveAttribute(
      "href",
      "/approvals"
    );

    fireEvent.click(screen.getByRole("button", { name: /customer intake/i }));

    expect(screen.getByText("Quota exhausted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show output/i })).toBeInTheDocument();
    expect(screen.getByText(/agent workers \(1 slot\)/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /debug with ai/i }));

    await waitFor(() => {
      expect(debugStepMock).toHaveBeenCalledWith("step-failure", "Quota exhausted", {
        retryable: false,
        raw: { provider: "openai" },
      });
    });

    expect(await screen.findByText(/provider rejected the request because usage is capped/i)).toBeInTheDocument();
    expect(screen.getByText(/switch to a fallback provider/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show output/i }));
    expect(screen.getByText(/"retryable": false/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /w1/i }));
    expect(screen.getByText(/message log/i)).toBeInTheDocument();
    expect(screen.getByText(/check account history/i)).toBeInTheDocument();
    expect(screen.getByText(/history checked/i)).toBeInTheDocument();
  });

  it("shows empty states when there are no runs", async () => {
    listRunsMock.mockResolvedValue([]);

    renderRunMonitor();

    expect(await screen.findByText(/no active runs/i)).toBeInTheDocument();
    expect(screen.getByText(/no completed runs yet/i)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /start a run/i })[0]).toHaveAttribute(
      "href",
      "/builder"
    );
  });

  it("shows the load error and retries successfully", async () => {
    listRunsMock
      .mockRejectedValueOnce(new Error("Run monitor failed"))
      .mockResolvedValueOnce([
        {
          id: "run-retry",
          templateId: "tpl-retry",
          templateName: "Retryable Run",
          status: "running",
          startedAt: "2026-04-22T10:00:00.000Z",
          input: {},
          output: {},
          stepResults: [],
        },
      ]);

    renderRunMonitor();

    expect(await screen.findByText(/run monitor unavailable/i)).toBeInTheDocument();
    expect(screen.getByText("Run monitor failed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByText("Retryable Run")).toBeInTheDocument();
    await waitFor(() => {
      expect(listRunsMock).toHaveBeenCalledTimes(2);
    });
  });

  it("surfaces API error messages from the runs endpoint instead of falling back to an empty state", async () => {
    listRunsMock.mockRejectedValueOnce(new Error("Unauthorized"));

    renderRunMonitor();

    expect(await screen.findByText(/run monitor unavailable/i)).toBeInTheDocument();
    expect(screen.getByText("Unauthorized")).toBeInTheDocument();
    expect(screen.queryByText(/no active runs/i)).not.toBeInTheDocument();
  });
});
