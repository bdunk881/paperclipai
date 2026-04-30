import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
});
