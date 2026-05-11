import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, AgentBudgetSnapshot } from "../api/agentApi";
import BudgetDashboard from "./BudgetDashboard";

const { getAccessTokenMock, listAgentsMock, getAgentBudgetMock, accessModeMock } = vi.hoisted(() => ({
  getAccessTokenMock: vi.fn(),
  listAgentsMock: vi.fn(),
  getAgentBudgetMock: vi.fn(),
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
  getAgentBudget: getAgentBudgetMock,
}));

describe("BudgetDashboard", () => {
  beforeEach(() => {
    getAccessTokenMock.mockReset();
    listAgentsMock.mockReset();
    getAgentBudgetMock.mockReset();
    accessModeMock.mockReset();
    accessModeMock.mockReturnValue("authenticated");
    getAccessTokenMock.mockResolvedValue("token-123");
    listAgentsMock.mockResolvedValue([]);
  });

  it("renders the preview empty state without calling protected budget APIs", async () => {
    accessModeMock.mockReturnValue("preview");
    getAccessTokenMock.mockResolvedValue(null);

    render(
      <MemoryRouter>
        <BudgetDashboard />
      </MemoryRouter>
    );

    expect(await screen.findByText(/no budget activity yet/i)).toBeInTheDocument();
    expect(listAgentsMock).not.toHaveBeenCalled();
    expect(getAgentBudgetMock).not.toHaveBeenCalled();
  });

  it("shows loading state initially", () => {
    listAgentsMock.mockReturnValue(new Promise(() => {}));
    render(<MemoryRouter><BudgetDashboard /></MemoryRouter>);
    expect(screen.getByText(/loading budget telemetry/i)).toBeInTheDocument();
  });

  it("shows auth error when token is null in authenticated mode", async () => {
    getAccessTokenMock.mockResolvedValueOnce(null);
    render(<MemoryRouter><BudgetDashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/authentication session expired/i)).toBeInTheDocument());
  });

  it("shows error message from thrown Error", async () => {
    listAgentsMock.mockRejectedValueOnce(new Error("API down"));
    render(<MemoryRouter><BudgetDashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("API down")).toBeInTheDocument());
  });

  it("shows fallback error message for non-Error throw", async () => {
    listAgentsMock.mockRejectedValueOnce("oops");
    render(<MemoryRouter><BudgetDashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/failed to load budget dashboard/i)).toBeInTheDocument());
  });

  it("shows empty state when no agents are returned", async () => {
    listAgentsMock.mockResolvedValueOnce([]);
    render(<MemoryRouter><BudgetDashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/no budget activity yet/i)).toBeInTheDocument());
  });

  it("renders agent name from budget snapshot", async () => {
    const agent: Partial<Agent> = {
      id: "a1", name: "Budget Agent", budgetMonthlyUsd: 50,
      status: "active", teamId: "t1", description: "", metadata: {},
    };
    const budget: Partial<AgentBudgetSnapshot> = {
      agentId: "a1", monthlyUsd: 100, spentUsd: 25,
    };
    listAgentsMock.mockResolvedValueOnce([agent]);
    getAgentBudgetMock.mockResolvedValueOnce(budget);
    render(<MemoryRouter><BudgetDashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Budget Agent")).toBeInTheDocument());
  });

  it("falls back to agent.budgetMonthlyUsd when budget snapshot is null", async () => {
    const agent: Partial<Agent> = {
      id: "a1", name: "Fallback Agent", budgetMonthlyUsd: 75,
      status: "active", teamId: "t1", description: "", metadata: {},
    };
    listAgentsMock.mockResolvedValueOnce([agent]);
    getAgentBudgetMock.mockResolvedValueOnce(null);
    render(<MemoryRouter><BudgetDashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Fallback Agent")).toBeInTheDocument());
  });
});
