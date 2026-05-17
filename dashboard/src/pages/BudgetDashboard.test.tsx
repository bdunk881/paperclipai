import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "../api/agentApi";
import type { BudgetRow } from "../api/canonicalApi";
import BudgetDashboard from "./BudgetDashboard";

const { getAccessTokenMock, listAgentsMock, listBudgetsMock, accessModeMock } = vi.hoisted(() => ({
  getAccessTokenMock: vi.fn(),
  listAgentsMock: vi.fn(),
  listBudgetsMock: vi.fn(),
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
  });

  it("shows loading state initially", () => {
    listAgentsMock.mockReturnValue(new Promise(() => {}));
    render(<MemoryRouter><BudgetDashboard /></MemoryRouter>);
    expect(screen.getByText(/loading budget telemetry/i)).toBeInTheDocument();
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
    listAgentsMock.mockRejectedValueOnce("oops");
    render(<MemoryRouter><BudgetDashboard /></MemoryRouter>);
    await waitFor(() =>
      expect(screen.getByText(/failed to load budget dashboard/i)).toBeInTheDocument(),
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
});
