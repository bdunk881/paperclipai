import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import MyAgents from "./MyAgents";

const { getAccessTokenMock, listAgentsMock, getAgentHeartbeatMock, getAgentBudgetMock, getAgentTokenUsageMock } = vi.hoisted(() => ({
  getAccessTokenMock: vi.fn(),
  listAgentsMock: vi.fn(),
  getAgentHeartbeatMock: vi.fn(),
  getAgentBudgetMock: vi.fn(),
  getAgentTokenUsageMock: vi.fn(),
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

vi.mock("../api/agentApi", () => ({
  listAgents: listAgentsMock,
  getAgentHeartbeat: getAgentHeartbeatMock,
  getAgentBudget: getAgentBudgetMock,
  getAgentTokenUsage: getAgentTokenUsageMock,
}));

describe("MyAgents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccessTokenMock.mockResolvedValue("token-123");
    listAgentsMock.mockResolvedValue([
      {
        id: "agent-1",
        userId: "user-1",
        name: "Outbound SDR",
        description: "Revenue pipeline owner",
        roleKey: "sales-operator",
        model: "gpt-4o-mini",
        instructions: "Handle outbound queue",
        budgetMonthlyUsd: 120,
        metadata: {},
        status: "running",
        createdAt: "2026-04-23T00:00:00.000Z",
        updatedAt: "2026-04-23T00:00:00.000Z",
      },
    ]);
    getAgentHeartbeatMock.mockResolvedValue({
      id: "heartbeat-1",
      agentId: "agent-1",
      userId: "user-1",
      status: "running",
      summary: "Processed outbound queue",
      tokenUsage: 8500,
      costUsd: 8.5,
      createdByRunId: "run-1",
      recordedAt: "2026-04-23T02:05:00.000Z",
    });
    getAgentBudgetMock.mockResolvedValue({
      agentId: "agent-1",
      userId: "user-1",
      monthlyUsd: 120,
      spentUsd: 8.5,
      remainingUsd: 111.5,
      currentPeriod: "2026-04",
      autoPaused: false,
      lastUpdatedAt: "2026-04-23T02:05:00.000Z",
    });
    getAgentTokenUsageMock.mockResolvedValue({
      agentId: "agent-1",
      userId: "user-1",
      days: 30,
      totalTokens: 8500,
      totalCostUsd: 8.5,
      daily: [],
    });
  });

  it("renders live agent API data", async () => {
    render(
      <MemoryRouter>
        <MyAgents />
      </MemoryRouter>
    );

    expect(await screen.findByText("Outbound SDR")).toBeInTheDocument();
    expect(screen.getByText("Revenue pipeline owner")).toBeInTheDocument();
    expect(screen.getAllByText("$8.50")).toHaveLength(2);
    expect(listAgentsMock).toHaveBeenCalledWith("token-123");
  });
});
