import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Approvals from "./Approvals";

const { listApprovalsMock, resolveApprovalMock } = vi.hoisted(() => ({
  listApprovalsMock: vi.fn(),
  resolveApprovalMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  listApprovals: listApprovalsMock,
  resolveApproval: resolveApprovalMock,
}));

describe("Approvals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the empty state when there are no approvals", async () => {
    listApprovalsMock.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <Approvals />
      </MemoryRouter>
    );

    expect(await screen.findByText("No approvals yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Review and resolve human-in-the-loop approval requests from your workflows."
      )
    ).toBeInTheDocument();
  });

  it("resolves a pending approval and updates its visible status", async () => {
    listApprovalsMock.mockResolvedValue([
      {
        id: "approval-1",
        runId: "run-123",
        templateName: "Customer Follow-up",
        stepId: "step-1",
        stepName: "Manager Review",
        assignee: "brad",
        message: "Approve this outbound reply before sending.",
        timeoutMinutes: 30,
        requestedAt: "2026-04-22T00:00:00.000Z",
        status: "pending",
      },
    ]);
    resolveApprovalMock.mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <Approvals />
      </MemoryRouter>
    );

    expect(await screen.findByText("Customer Follow-up")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Optional comment (visible to requester)…"), {
      target: { value: "Looks good to send." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(resolveApprovalMock).toHaveBeenCalledWith(
        "approval-1",
        "approved",
        "Looks good to send."
      );
    });

    expect(await screen.findByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Customer Follow-up")).toBeInTheDocument();
  });
});
