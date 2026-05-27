/**
 * Approvals — v2 editorial governance board tests.
 *
 * Asserts:
 *   - Page chrome (`.af2-v2`, `.af2-page`, `.page-head`, `h1.h1`).
 *   - Heading "Approvals".
 *   - Pending action approval rows render with Approve / Reject buttons
 *     wired to resolveApproval().
 *   - HEL-217: plan-mode approval rows (templateName ===
 *     "__autoflow_plan_approval__") render the plan text in a
 *     preformatted block, hide the original prompt behind a toggle,
 *     surface the "will replay within ~30s" callout after approve, and
 *     call resolveApproval() with the right args.
 */
import { fireEvent, waitFor, screen } from "@testing-library/react-original";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../test/render";
import Approvals from "./Approvals";

const { listApprovalsMock, resolveApprovalMock } = vi.hoisted(() => ({
  listApprovalsMock: vi.fn(),
  resolveApprovalMock: vi.fn(),
}));

const requireAccessTokenMock = vi.fn();

vi.mock("../api/client", () => ({
  listApprovals: listApprovalsMock,
  resolveApproval: resolveApprovalMock,
  getHitlCompanyState: vi.fn().mockResolvedValue({ askCeoRequests: [] }),
  createHitlAskCeoRequest: vi.fn(),
}));

vi.mock("../api/trackedFetch", () => ({
  trackedFetch: vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ policies: [], actionTypes: [], modes: [], total: 0 }),
  }),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-123", email: "operator@example.com", name: "Operator" },
    accessMode: "authenticated",
    getAccessToken: requireAccessTokenMock,
    requireAccessToken: requireAccessTokenMock,
  }),
}));

vi.mock("../context/useWorkspace", () => ({
  useWorkspace: () => ({
    activeWorkspaceId: "ws-1",
    activeWorkspace: { id: "ws-1", slug: "demo", role: "admin" },
  }),
}));

vi.mock("./AgentsRouteContext", () => ({
  useAgentsQuery: () => ({ data: [], isLoading: false }),
}));

vi.mock("../hooks/queries/useAgentsQuery", () => ({
  useAgentsQuery: () => ({ data: [], isLoading: false }),
}));

vi.mock("../hooks/queries/resolveAccessToken", () => ({
  useResolveAccessToken: () => requireAccessTokenMock,
}));

const SAMPLE_ACTION_APPROVAL = {
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
  agentId: "agent-publisher",
};

const PLAN_APPROVAL_TEMPLATE_NAME = "__autoflow_plan_approval__";
const PLAN_APPROVAL_DELIMITER = "\n\n---ORIGINAL_PROMPT---\n\n";
const PLAN_TEXT = "1. Look up the contact.\n2. Send the intro email.\n3. Log the touch.";
const ORIGINAL_PROMPT = "Reach out to the new lead from yesterday's webinar.";

const SAMPLE_PLAN_APPROVAL = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  runId: "run-plan-1",
  templateName: PLAN_APPROVAL_TEMPLATE_NAME,
  stepId: "step-plan",
  stepName: "Approve plan for SalesRep",
  assignee: "user-123",
  message: `${PLAN_TEXT}${PLAN_APPROVAL_DELIMITER}${ORIGINAL_PROMPT}`,
  timeoutMinutes: 1440,
  requestedAt: "2026-04-27T11:00:00.000Z",
  status: "pending" as const,
  agentId: "agent-sales",
};

describe("Approvals — Queue tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAccessTokenMock.mockResolvedValue("token-123");
    listApprovalsMock.mockResolvedValue([SAMPLE_ACTION_APPROVAL]);
    resolveApprovalMock.mockResolvedValue(undefined);
  });

  it("renders v2 page chrome + heading", async () => {
    const { container } = render(
      <MemoryRouter>
        <Approvals />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: /^Approvals$/i, level: 1 });
    expect(container.querySelector(".af2-v2")).not.toBeNull();
    expect(container.querySelector(".af2-page")).not.toBeNull();
    expect(container.querySelector(".page-head")).not.toBeNull();
  });

  it("renders pending action-approval rows with the message + buttons", async () => {
    render(
      <MemoryRouter>
        <Approvals />
      </MemoryRouter>,
    );
    // Approval message renders in both the row title (`<b>`) and the
    // drawer headline (`<h3>`); use findAllByText so the duplication
    // doesn't throw.
    const matches = await screen.findAllByText("Approve the final ship candidate.");
    expect(matches.length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /^Approve$/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /^Reject$/i }).length).toBeGreaterThan(0);
  });

  it("calls resolveApproval('approved') when the row Approve button is clicked", async () => {
    render(
      <MemoryRouter>
        <Approvals />
      </MemoryRouter>,
    );
    await screen.findAllByText("Approve the final ship candidate.");
    fireEvent.click(screen.getAllByRole("button", { name: /^Approve$/i })[0]);
    await waitFor(() => {
      expect(resolveApprovalMock).toHaveBeenCalledWith(
        SAMPLE_ACTION_APPROVAL.id,
        "approved",
        "token-123",
      );
    });
  });
});

describe("Approvals — HEL-217 plan-mode UX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAccessTokenMock.mockResolvedValue("token-123");
    listApprovalsMock.mockResolvedValue([SAMPLE_PLAN_APPROVAL]);
    resolveApprovalMock.mockResolvedValue(undefined);
  });

  it("renders the plan text in a preformatted block", async () => {
    render(
      <MemoryRouter>
        <Approvals />
      </MemoryRouter>,
    );
    await screen.findByText(/Proposed plan/i);
    // The plan text is rendered as preformatted whitespace-preserving
    // content. Use a regex over the trimmed body since whitespace differs.
    expect(screen.getByText(/Look up the contact\./)).toBeInTheDocument();
    expect(screen.getByText(/Send the intro email\./)).toBeInTheDocument();
    expect(screen.getByText(/Log the touch\./)).toBeInTheDocument();
  });

  it("hides the original prompt behind a Show button by default", async () => {
    render(
      <MemoryRouter>
        <Approvals />
      </MemoryRouter>,
    );
    await screen.findByText(/Proposed plan/i);
    expect(screen.queryByText(/Reach out to the new lead/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Show original prompt/i }));
    expect(
      screen.getByText(/Reach out to the new lead from yesterday's webinar\./),
    ).toBeInTheDocument();
  });

  it("uses 'Approve plan' as the row primary CTA for plan rows", async () => {
    render(
      <MemoryRouter>
        <Approvals />
      </MemoryRouter>,
    );
    await screen.findByText(/Proposed plan/i);
    expect(screen.getAllByRole("button", { name: /^Approve plan$/i }).length).toBeGreaterThan(
      0,
    );
  });

  it("calls resolveApproval('approved') and shows the replay callout after Approve", async () => {
    render(
      <MemoryRouter>
        <Approvals />
      </MemoryRouter>,
    );
    await screen.findByText(/Proposed plan/i);
    fireEvent.click(screen.getAllByRole("button", { name: /^Approve plan$/i })[0]);
    await waitFor(() => {
      expect(resolveApprovalMock).toHaveBeenCalledWith(
        SAMPLE_PLAN_APPROVAL.id,
        "approved",
        "token-123",
      );
    });
    await screen.findByText(/will replay within/i);
  });

  it("calls resolveApproval('rejected') on Reject", async () => {
    render(
      <MemoryRouter>
        <Approvals />
      </MemoryRouter>,
    );
    await screen.findByText(/Proposed plan/i);
    fireEvent.click(screen.getAllByRole("button", { name: /^Reject$/i })[0]);
    await waitFor(() => {
      expect(resolveApprovalMock).toHaveBeenCalledWith(
        SAMPLE_PLAN_APPROVAL.id,
        "rejected",
        "token-123",
      );
    });
  });
});
