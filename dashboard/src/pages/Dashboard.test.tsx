import { fireEvent, render, screen } from "@testing-library/react";
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
  navigateMock,
} = vi.hoisted(() => ({
  listRunsMock: vi.fn(),
  listTemplatesMock: vi.fn(),
  listLLMConfigsMock: vi.fn(),
  listAgentsMock: vi.fn(),
  listRoutinesMock: vi.fn(),
  getAccessTokenMock: vi.fn(),
  navigateMock: vi.fn(),
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

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

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

  it("renders dashboard stats, recent runs, workflows, and hides onboarding when completed", async () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn().mockReturnValue("true"),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    listRunsMock.mockResolvedValue([
      {
        id: "run_1",
        templateId: "tpl_1",
        templateName: "Lead Routing",
        status: "completed",
        startedAt: "2026-04-22T08:00:00.000Z",
        input: {},
        output: {},
        stepResults: [],
      },
      {
        id: "run_2",
        templateId: "tpl_2",
        templateName: "Ops Audit",
        status: "failed",
        startedAt: "2026-04-22T09:00:00.000Z",
        input: {},
        output: {},
        stepResults: [],
      },
      {
        id: "run_3",
        templateId: "tpl_3",
        templateName: "Weekly Check-in",
        status: "running",
        startedAt: "2026-04-22T10:00:00.000Z",
        input: {},
        output: {},
        stepResults: [],
      },
    ]);
    listTemplatesMock.mockResolvedValue([
      {
        id: "tpl_1",
        name: "Lead Routing",
        description: "Routes leads",
        category: "sales",
        version: "1.0.0",
        stepCount: 4,
        configFieldCount: 2,
      },
      {
        id: "tpl_2",
        name: "Ops Audit",
        description: "Checks ops",
        category: "operations",
        version: "1.0.0",
        stepCount: 4,
        configFieldCount: 2,
      },
    ]);
    listLLMConfigsMock.mockResolvedValue([
      {
        id: "cfg_1",
        label: "Primary",
        provider: "openai",
        model: "gpt-4o",
        isDefault: true,
        maskedApiKey: "sk-...1234",
        createdAt: "2026-04-22T00:00:00.000Z",
      },
    ]);

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(screen.getByText("33% success")).toBeInTheDocument();
    expect(screen.getByText("67% failure")).toBeInTheDocument();
    expect(screen.getAllByText("Lead Routing").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ops Audit").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /setup guide/i })).not.toBeInTheDocument();
  });

  it("shows onboarding, reopens it, and navigates through command prompts", async () => {
    const localStorageMock = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", localStorageMock);
    listRunsMock.mockResolvedValue([]);
    listTemplatesMock.mockResolvedValue([
      {
        id: "tpl_sales",
        name: "Sales Follow-up",
        description: "Follow-up workflow",
        category: "sales",
        version: "1.0.0",
        stepCount: 4,
        configFieldCount: 2,
      },
    ]);
    listLLMConfigsMock.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    expect(await screen.findByRole("button", { name: /setup guide/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /setup guide/i }));
    expect(localStorageMock.removeItem).toHaveBeenCalledWith("autoflow:onboarding-dismissed:v1:user-1");

    fireEvent.click(screen.getByRole("button", { name: /create a lead magnet workflow/i }));
    expect(navigateMock).toHaveBeenCalledWith(
      "/builder",
      expect.objectContaining({
        state: { copilotPrompt: "Create a lead magnet workflow" },
      })
    );

    fireEvent.change(screen.getByLabelText(/what do you want to build/i), {
      target: { value: "find sales follow-up" },
    });
    fireEvent.click(screen.getByRole("button", { name: /ask/i }));
    expect(await screen.findByText("Suggested workflows")).toBeInTheDocument();
    expect(screen.getAllByText("Sales Follow-up").length).toBeGreaterThan(0);
  });

  it("renders the error state and retries loading", async () => {
    listRunsMock.mockRejectedValueOnce(new Error("Dashboard broke"));
    listRunsMock.mockResolvedValueOnce([]);

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    expect(await screen.findByText("Dashboard data unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("Welcome back, Test")).toBeInTheDocument();
    expect(listRunsMock).toHaveBeenCalledTimes(2);
  });
});
