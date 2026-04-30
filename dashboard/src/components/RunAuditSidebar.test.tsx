import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunAuditSidebar } from "./RunAuditSidebar";
import type { WorkflowRun } from "../types/workflow";

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

describe("RunAuditSidebar", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the workflow builder in a new tab from the audit sidebar", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<RunAuditSidebar run={RUN_FIXTURE} open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /open support triage in the workflow builder/i }));

    expect(openSpy).toHaveBeenCalledWith(
      "/builder/tpl-1?popout=1&mode=readonly&from=%2Fhistory",
      "_blank",
      "noopener,noreferrer"
    );
  });
});
