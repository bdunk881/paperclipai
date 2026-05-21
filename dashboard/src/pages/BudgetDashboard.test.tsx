import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "../api/agentApi";
import type { BudgetRow } from "../api/canonicalApi";
import BudgetDashboard from "./BudgetDashboard";

const {
  getAccessTokenMock,
  listAgentsMock,
  listBudgetsMock,
  listBudgetAlertsMock,
  accessModeMock,
} = vi.hoisted(() => ({
  getAccessTokenMock: vi.fn(),
  listAgentsMock: vi.fn(),
  listBudgetsMock: vi.fn(),
  listBudgetAlertsMock: vi.fn(),
  accessModeMock: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    accessMode: accessModeMock(),
    getAccessToken: getAccessTokenMock,
  }),
}));

vi.mock("../api/agentApi", () => ({
  listAgents: listAgentsMock,
}));

vi.mock("../api/canonicalApi", () => ({
  listBudgets: listBudgetsMock,
}));

vi.mock("../api/controlPlane", () => ({
  listBudgetAlerts: listBudgetAlertsMock,
}));

function agent(overrides: Partial<Agent> & Pick<Agent, "id" | "name">): Agent {
  return {
    id: overrides.id,
    userId: "u1",
    name: overrides.name,
    description: null,
    roleKey: null,
    model: null,
    instructions: "",
    status: "active" as Agent["status"],
    budgetMonthlyUsd: 0,
    metadata: {},
    lastHeartbeatAt: null,
    lastRunAt: null,
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    ...overrides,
  } as Agent;
}

function budgetRow(
  agentId: string,
  monthlyUsd: number,
  spentUsd: number,
): BudgetRow {
  return {
    id: `budget-${agentId}`,
    scopeKind: "agent",
    scopeId: agentId,
    capCents: Math.round(monthlyUsd * 100),
    usedCents: Math.round(spentUsd * 100),
    period: "monthly",
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
  };
}

describe("BudgetDashboard", () => {
  beforeEach(() => {
    getAccessTokenMock.mockReset();
    listAgentsMock.mockReset();
    listBudgetsMock.mockReset();
    accessModeMock.mockReset();
    accessModeMock.mockReturnValue("authenticated");
    getAccessTokenMock.mockResolvedValue("token-123");
    listAgentsMock.mockResolvedValue([]);
    listBudgetsMock.mockResolvedValue([]);
    listBudgetAlertsMock.mockReset();
    listBudgetAlertsMock.mockResolvedValue([]);
  });

  it("shows page chrome while budget data is loading", () => {
    listAgentsMock.mockReturnValue(new Promise(() => {}));
    render(<MemoryRouter><BudgetDashboard /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: /budget/i })).toBeInTheDocument();
  });

  it("renders v2 chrome — eyebrow, h1, stat strip labels", async () => {
    listAgentsMock.mockResolvedValueOnce([]);
    render(<MemoryRouter><BudgetDashboard /></MemoryRouter>);

    expect(
      await screen.findByRole("heading", { level: 1, name: /budget/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/workforce · spend/i)).toBeInTheDocument();
    expect(screen.getByText(/spent · mtd/i)).toBeInTheDocument();
    expect(screen.getByText(/forecast · eom/i)).toBeInTheDocument();
    expect(screen.getByText(/top spender/i)).toBeInTheDocument();
    expect(screen.getByText(/cost per hour saved/i)).toBeInTheDocument();
    // DASH-5: the page no longer renders the dead "Forecast" /
    // "Adjust caps" page actions. Forecast info is in the visible
    // stat strip; per-agent cap edits live on each row's Edit
    // button until a workspace-wide caps modal ships.
    expect(
      screen.queryByRole("button", { name: /^forecast$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /adjust caps/i }),
    ).not.toBeInTheDocument();
  });

  it("renders empty state when no agents are returned", async () => {
    listAgentsMock.mockResolvedValueOnce([]);
    render(<MemoryRouter><BudgetDashboard /></MemoryRouter>);
    await waitFor(() =>
      expect(screen.getByText(/no spend recorded yet/i)).toBeInTheDocument(),
    );
  });

  it("renders the preview empty state without calling protected budget APIs", async () => {
    accessModeMock.mockReturnValue("preview");
    getAccessTokenMock.mockResolvedValue(null);

    render(
      <MemoryRouter>
        <BudgetDashboard />
      </MemoryRouter>
    );

    expect(
      await screen.findByText(/no spend recorded yet/i),
    ).toBeInTheDocument();
    expect(listAgentsMock).not.toHaveBeenCalled();
    expect(listBudgetsMock).not.toHaveBeenCalled();
    // HEL-143 Codex P2: preview early-return clears alerts so prior
    // authenticated state doesn't leak into the new preview render.
    expect(listBudgetAlertsMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/recent budget alerts/i)).not.toBeInTheDocument();
  });

  it("shows auth error when token is null in authenticated mode", async () => {
    getAccessTokenMock.mockResolvedValueOnce(null);
    render(<MemoryRouter><BudgetDashboard /></MemoryRouter>);
    await waitFor(() =>
      expect(screen.getByText(/authentication session expired/i)).toBeInTheDocument(),
    );
  });

  it("shows error message from thrown Error", async () => {
    listAgentsMock.mockRejectedValueOnce(new Error("API down"));
    render(<MemoryRouter><BudgetDashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("API down")).toBeInTheDocument());
  });

  it("shows fallback error message for non-Error throw", async () => {
    listAgentsMock.mockRejectedValueOnce(new Error("oops"));
    render(<MemoryRouter><BudgetDashboard /></MemoryRouter>);
    await waitFor(() =>
      expect(screen.getByText(/oops/i)).toBeInTheDocument(),
    );
  });

  it("renders per-agent rows with name, role, spent and cap", async () => {
    listAgentsMock.mockResolvedValueOnce([
      agent({ id: "a1", name: "Devon", roleKey: "CTO", budgetMonthlyUsd: 700 }),
      agent({ id: "a2", name: "Maya", roleKey: "Ops", budgetMonthlyUsd: 500 }),
    ]);
    listBudgetsMock.mockResolvedValueOnce([
      budgetRow("a1", 700, 510),
      budgetRow("a2", 500, 120),
    ]);

    render(<MemoryRouter><BudgetDashboard /></MemoryRouter>);

    // "Devon" appears twice (top-spender stat + by-agent row); "Maya" only in
    // the row. Use getAllByText for the duplicated name.
    await waitFor(() =>
      expect(screen.getAllByText("Devon").length).toBeGreaterThanOrEqual(1),
    );
    expect(screen.getByText("Maya")).toBeInTheDocument();
    // Role labels render under the agent name (and again in the top-spender
    // delta line for the highest spender — assert it's present at all).
    expect(screen.getAllByText("CTO").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Ops")).toBeInTheDocument();
    // Cap column renders the monthly budget.
    expect(screen.getByText("$700")).toBeInTheDocument();
    expect(screen.getByText("$500")).toBeInTheDocument();
    // Spent column renders the per-agent spend. ("$510" also appears in the
    // top-spender delta so allow multiple matches.)
    expect(screen.getAllByText("$510").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("$120")).toBeInTheDocument();
    // Per-row Edit button (one per agent).
    const editButtons = screen.getAllByRole("button", { name: /edit/i });
    expect(editButtons).toHaveLength(2);
    // By-agent header.
    expect(
      screen.getByRole("heading", { level: 3, name: /by agent/i }),
    ).toBeInTheDocument();
    // By-model placeholder section.
    expect(
      screen.getByRole("heading", { level: 3, name: /by model · last 30 days/i }),
    ).toBeInTheDocument();
  });

  it("falls back to agent.budgetMonthlyUsd when budget snapshot is null", async () => {
    listAgentsMock.mockResolvedValueOnce([
      agent({ id: "a1", name: "Fallback Agent", budgetMonthlyUsd: 75 }),
    ]);
    listBudgetsMock.mockResolvedValueOnce([]);
    render(<MemoryRouter><BudgetDashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Fallback Agent")).toBeInTheDocument());
    expect(screen.getByText("$75")).toBeInTheDocument();
  });

  // HEL-143: budget_alerts surface
  describe("Recent budget alerts panel (HEL-143)", () => {
    it("renders the 'Recent budget alerts' heading + a row per alert when the store returns alerts", async () => {
      listAgentsMock.mockResolvedValue([
        agent({ id: "agent-atlas", name: "Atlas" }),
      ]);
      listBudgetAlertsMock.mockResolvedValueOnce([
        {
          id: "alert-1",
          teamId: "team-abc12345",
          userId: "u1",
          agentId: "agent-atlas",
          scope: "agent",
          threshold: 0.8,
          budgetUsd: 100,
          spentUsd: 82,
          recordedAt: "2026-05-19T14:14:00.000Z",
        },
        {
          id: "alert-2",
          teamId: "team-xyz",
          userId: "u1",
          scope: "team",
          threshold: 1,
          budgetUsd: 500,
          spentUsd: 532,
          recordedAt: "2026-05-18T08:30:00.000Z",
        },
      ]);

      render(<MemoryRouter><BudgetDashboard /></MemoryRouter>);

      await waitFor(() =>
        expect(
          screen.getByRole("heading", { level: 3, name: /recent budget alerts/i }),
        ).toBeInTheDocument(),
      );

      // Both thresholds rendered as percent pills.
      expect(screen.getByText(/80% threshold/i)).toBeInTheDocument();
      expect(screen.getByText(/100% threshold/i)).toBeInTheDocument();

      // Agent-scoped alert links to the agent detail page.
      const agentLink = screen.getByRole("link", { name: /Agent agent-at/i });
      expect(agentLink).toHaveAttribute("href", "/agents/agent-atlas");

      // Spend / cap copy renders for both alerts. We don't assert exact
      // currency formatting (locale-dependent) — assert the cap values
      // appear in some form.
      expect(screen.getByText(/\$82.*\$100/)).toBeInTheDocument();
      // Over-budget alert calls out the overage.
      expect(screen.getByText(/over by/i)).toBeInTheDocument();
    });

    it("hides the alerts panel entirely when the store returns an empty list (healthy workspace)", async () => {
      listAgentsMock.mockResolvedValue([
        agent({ id: "a1", name: "Quiet Agent", budgetMonthlyUsd: 100 }),
      ]);
      listBudgetAlertsMock.mockResolvedValueOnce([]);

      render(<MemoryRouter><BudgetDashboard /></MemoryRouter>);
      await waitFor(() => expect(screen.getByText("Quiet Agent")).toBeInTheDocument());

      expect(
        screen.queryByRole("heading", { name: /recent budget alerts/i }),
      ).not.toBeInTheDocument();
    });

    it("does not blow up the whole page when the alerts fetch rejects", async () => {
      listAgentsMock.mockResolvedValue([
        agent({ id: "a1", name: "Resilient Agent", budgetMonthlyUsd: 50 }),
      ]);
      listBudgetAlertsMock.mockRejectedValueOnce(new Error("backend offline"));

      render(<MemoryRouter><BudgetDashboard /></MemoryRouter>);
      // The agents table still renders — alerts failure is swallowed.
      await waitFor(() => expect(screen.getByText("Resilient Agent")).toBeInTheDocument());
      // No alerts heading either.
      expect(
        screen.queryByRole("heading", { name: /recent budget alerts/i }),
      ).not.toBeInTheDocument();
    });

    it("shows a 'Showing 10 of N alerts' footer when there are more than 10", async () => {
      const alerts = Array.from({ length: 14 }, (_, i) => ({
        id: `alert-${i}`,
        teamId: "team-1",
        userId: "u1",
        scope: "team" as const,
        threshold: 0.5,
        budgetUsd: 100,
        spentUsd: 51,
        recordedAt: new Date(2026, 4, 1 + i).toISOString(),
      }));
      listBudgetAlertsMock.mockResolvedValueOnce(alerts);

      render(<MemoryRouter><BudgetDashboard /></MemoryRouter>);
      await waitFor(() =>
        expect(
          screen.getByRole("heading", { level: 3, name: /recent budget alerts/i }),
        ).toBeInTheDocument(),
      );

      expect(screen.getByText(/Showing 10 of 14 alerts/i)).toBeInTheDocument();
    });
  });
});
