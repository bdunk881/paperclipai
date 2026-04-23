import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard";

const {
  listRunsMock,
  listTemplatesMock,
  listLLMConfigsMock,
  listAgentsMock,
  listRoutinesMock,
  getAccessTokenMock,
} = vi.hoisted(() => ({
  listRunsMock: vi.fn(),
  listTemplatesMock: vi.fn(),
  listLLMConfigsMock: vi.fn(),
  listAgentsMock: vi.fn(),
  listRoutinesMock: vi.fn(),
  getAccessTokenMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  listRuns: listRunsMock,
  listTemplates: listTemplatesMock,
  listLLMConfigs: listLLMConfigsMock,
}));

vi.mock("../api/agentApi", () => ({
  listAgents: listAgentsMock,
  listRoutines: listRoutinesMock,
  getAgentBudget: vi.fn().mockResolvedValue(null),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "user@example.com", name: "Test User" },
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
    getAccessToken: getAccessTokenMock,
  }),
}));

describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    getAccessTokenMock.mockResolvedValue("mock-token");
    listRunsMock.mockResolvedValue([]);
    listTemplatesMock.mockResolvedValue([]);
    listLLMConfigsMock.mockResolvedValue([]);
    listAgentsMock.mockResolvedValue([]);
    listRoutinesMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes access token to authenticated dashboard APIs", async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await screen.findByText("Welcome back, Test");

    expect(getAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(listRunsMock).toHaveBeenCalledWith(undefined, "mock-token");
    expect(listLLMConfigsMock).toHaveBeenCalledWith("mock-token");
    expect(listAgentsMock).toHaveBeenCalledWith("mock-token");
    expect(listRoutinesMock).toHaveBeenCalledWith("mock-token");
    expect(screen.queryByText("Dashboard data unavailable")).not.toBeInTheDocument();
  });
});
