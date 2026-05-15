/**
 * Approvals — v2 editorial governance board tests.
 *
 * Asserts:
 *   - v2 page chrome (`.af2-page`, `.af2-page-head`, `h1.af2-h1`).
 *   - Eyebrow "Governance · Board" + heading "Approvals".
 *   - Pending approval message rows render.
 *   - Each row has Approve + Reject buttons.
 *   - Clicking Approve invokes resolveApproval with the right args
 *     and the API is then refetched.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Approvals from "./Approvals";

const { listApprovalsMock, resolveApprovalMock } = vi.hoisted(() => ({
  listApprovalsMock: vi.fn(),
  resolveApprovalMock: vi.fn(),
}));

const requireAccessTokenMock = vi.fn();

vi.mock("../api/client", () => ({
  listApprovals: listApprovalsMock,
  resolveApproval: resolveApprovalMock,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-123", email: "operator@example.com", name: "Operator" },
    requireAccessToken: requireAccessTokenMock,
  }),
}));

const SAMPLE_APPROVALS = [
  {
    id: "11111111-2222-3333-4444-555555555555",
    runId: "run-1",
    templateName: "Launch Plan",
    stepId: "step-approve",
    stepName: "Publish sign-off",
    assignee: "Brad Dunk",
    message: "Approve the final ship candidate.",
    timeoutMinutes: 60,
    requestedAt: "2026-04-27T12:15:00.000Z",
    status: "pending" as const,
  },
  {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    runId: "run-2",
    templateName: "Migration",
    stepId: "step-confirm",
    stepName: "Schema cutover",
    assignee: "Casey Smith",
    message: "Confirm Postgres cutover window.",
    timeoutMinutes: 10,
    requestedAt: "2026-04-27T11:00:00.000Z",
    status: "pending" as const,
  },
];

describe("Approvals (v2 Governance board)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAccessTokenMock.mockResolvedValue("token-123");
    listApprovalsMock.mockResolvedValue(SAMPLE_APPROVALS);
    resolveApprovalMock.mockResolvedValue(undefined);
  });

  it("renders the v2 page chrome", async () => {
    const { container } = render(
      <MemoryRouter>
        <Approvals />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: /^Approvals$/i, level: 1 });

    expect(container.querySelector(".af2-page")).not.toBeNull();
    expect(container.querySelector(".af2-page-head")).not.toBeNull();
    expect(container.querySelector("h1.af2-h1")).not.toBeNull();
  });

  it("renders the eyebrow and heading", async () => {
    render(
      <MemoryRouter>
        <Approvals />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: /^Approvals$/i, level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Governance · Board")).toBeInTheDocument();
  });

  it("renders pending approval messages", async () => {
    render(
      <MemoryRouter>
        <Approvals />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("Approve the final ship candidate."),
    ).toBeInTheDocument();
    expect(screen.getByText("Confirm Postgres cutover window.")).toBeInTheDocument();
  });

  it("renders Approve and Reject buttons per pending row", async () => {
    render(
      <MemoryRouter>
        <Approvals />
      </MemoryRouter>,
    );

    await screen.findByText("Approve the final ship candidate.");

    expect(screen.getAllByRole("button", { name: /^Approve$/i })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^Reject$/i })).toHaveLength(2);
  });

  it("calls resolveApproval and refetches on Approve", async () => {
    render(
      <MemoryRouter>
        <Approvals />
      </MemoryRouter>,
    );

    await screen.findByText("Approve the final ship candidate.");
    expect(listApprovalsMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByRole("button", { name: /^Approve$/i })[0]);

    await waitFor(() => {
      expect(resolveApprovalMock).toHaveBeenCalledWith(
        SAMPLE_APPROVALS[0].id,
        "approved",
        "token-123",
      );
    });

    await waitFor(() => {
      expect(listApprovalsMock).toHaveBeenCalledTimes(2);
    });
  });
});
