import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { RunAuditSidebar } from "./RunAuditSidebar";
import type { WorkflowRun } from "../types/workflow";
import * as apiClient from "../api/client";

const RUN_FIXTURE: WorkflowRun = {
  id: "run-1",
  templateId: "tpl-1",
  templateName: "Support triage",
  status: "completed",
  startedAt: "2026-04-30T02:00:00.000Z",
  completedAt: "2026-04-30T02:01:00.000Z",
  input: { ticketId: "123" },
  output: {},
  stepResults: [
    {
      stepId: "step-1",
      stepName: "Classify",
      status: "success",
      output: { result: "high-priority" },
      durationMs: 500,
    },
  ],
};

// HEL-176 replay fixture: 3-step run where step 3 failed. Step indices
// are zero-based, so the failed step is index 2 and the replay button
// should request stepIndex=2.
const FAILED_RUN_FIXTURE: WorkflowRun = {
  id: "run-failed-1",
  templateId: "tpl-1",
  templateName: "Support triage",
  status: "failed",
  startedAt: "2026-04-30T02:00:00.000Z",
  completedAt: "2026-04-30T02:01:00.000Z",
  input: {},
  stepResults: [
    {
      stepId: "step-1",
      stepName: "Classify",
      status: "success",
      output: { result: "high-priority" },
      durationMs: 500,
    },
    {
      stepId: "step-2",
      stepName: "Enrich",
      status: "success",
      output: { enriched: true },
      durationMs: 600,
    },
    {
      stepId: "step-3",
      stepName: "Publish",
      status: "failure",
      output: {},
      durationMs: 200,
      error: "Network blip",
    },
  ],
};

function renderInRouter(node: React.ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe("RunAuditSidebar", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the workflow builder in a new tab from the audit sidebar", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    renderInRouter(<RunAuditSidebar run={RUN_FIXTURE} open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /open support triage in the workflow builder/i }));

    expect(openSpy).toHaveBeenCalledWith(
      "/builder/tpl-1?popout=1&mode=readonly&from=%2Fhistory",
      "_blank",
      "noopener,noreferrer"
    );
  });
});

describe("RunAuditSidebar — HEL-176 replay-from-step", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a 'Replay from here' CTA on the failed step", () => {
    renderInRouter(<RunAuditSidebar run={FAILED_RUN_FIXTURE} open onClose={vi.fn()} />);

    // The CTA only appears on the failed (third) step. The first two
    // are 'success' so they must NOT show the button.
    const replayButtons = screen.getAllByRole("button", { name: /replay run from step 3/i });
    expect(replayButtons).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: /replay run from step 1/i })
    ).toBeNull();
  });

  it("opens the confirmation modal when the CTA is clicked", () => {
    renderInRouter(<RunAuditSidebar run={FAILED_RUN_FIXTURE} open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /replay run from step 3/i }));

    expect(screen.getByRole("dialog", { name: /replay from step 3/i })).toBeInTheDocument();
    expect(screen.getByText(/the original run stays intact/i)).toBeInTheDocument();
  });

  it("calls replayRunFromStep with the step index on confirm", async () => {
    const spy = vi.spyOn(apiClient, "replayRunFromStep").mockResolvedValue({
      ...FAILED_RUN_FIXTURE,
      id: "new-run-1",
      status: "pending",
    });

    const onClose = vi.fn();
    renderInRouter(
      <RunAuditSidebar run={FAILED_RUN_FIXTURE} open onClose={onClose} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /replay run from step 3/i }));
    fireEvent.click(screen.getByRole("button", { name: /^replay run$/i }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith("run-failed-1", 2, undefined);
    // After a successful replay the sidebar closes so the operator
    // lands on the new run's view.
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("surfaces API errors in the modal and leaves it open", async () => {
    vi.spyOn(apiClient, "replayRunFromStep").mockRejectedValue(
      new Error("Backend offline"),
    );

    renderInRouter(<RunAuditSidebar run={FAILED_RUN_FIXTURE} open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /replay run from step 3/i }));
    fireEvent.click(screen.getByRole("button", { name: /^replay run$/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/backend offline/i);
    });
    // The dialog is still visible because the replay failed.
    expect(screen.getByRole("dialog", { name: /replay from step 3/i })).toBeInTheDocument();
  });
});
