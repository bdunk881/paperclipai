import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, AgentBudgetSnapshot } from "../api/agentApi";
import OrgStructure from "./OrgStructure";

const {
  getAccessTokenMock,
  listAgentsMock,
  listMissionsMock,
  getAgentBudgetMock,
  accessModeMock,
  trackedFetchMock,
} = vi.hoisted(() => ({
  getAccessTokenMock: vi.fn(),
  listAgentsMock: vi.fn(),
  listMissionsMock: vi.fn(),
  getAgentBudgetMock: vi.fn(),
  accessModeMock: vi.fn(),
  trackedFetchMock: vi.fn(),
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

vi.mock("../api/missionsApi", () => ({
  listMissions: listMissionsMock,
}));

vi.mock("../api/trackedFetch", () => ({
  trackedFetch: trackedFetchMock,
}));

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    name: "Agent One",
    roleKey: "worker",
    status: "running",
    description: "",
    instructions: "",
    userId: "u1",
    budgetMonthlyUsd: 0,
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Agent;
}

function makeBudget(overrides: Partial<AgentBudgetSnapshot> = {}): AgentBudgetSnapshot {
  return {
    agentId: "a1",
    userId: "u1",
    monthlyUsd: 0,
    spentUsd: 0,
    remainingUsd: 0,
    currentPeriod: "2026-05",
    autoPaused: false,
    lastUpdatedAt: null,
    ...overrides,
  };
}

function mockOrgGraphEmpty() {
  trackedFetchMock.mockResolvedValue(
    new Response(JSON.stringify({ workspaceId: "w1", agents: [], edges: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("OrgStructure", () => {
  beforeEach(() => {
    getAccessTokenMock.mockReset();
    listAgentsMock.mockReset();
    listMissionsMock.mockReset();
    getAgentBudgetMock.mockReset();
    accessModeMock.mockReset();
    trackedFetchMock.mockReset();
    accessModeMock.mockReturnValue("authenticated");
    getAccessTokenMock.mockResolvedValue("token-123");
    listAgentsMock.mockResolvedValue([]);
    listMissionsMock.mockResolvedValue([]);
    getAgentBudgetMock.mockResolvedValue(null);
    mockOrgGraphEmpty();
  });

  it("renders the preview empty state without calling protected agent APIs", async () => {
    accessModeMock.mockReturnValue("preview");
    getAccessTokenMock.mockResolvedValue(null);

    render(
      <MemoryRouter>
        <OrgStructure />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/no team yet/i)).toBeInTheDocument();
    expect(listAgentsMock).not.toHaveBeenCalled();
  });

  it("shows loading state initially", () => {
    listAgentsMock.mockReturnValue(new Promise(() => {}));
    render(
      <MemoryRouter>
        <OrgStructure />
      </MemoryRouter>,
    );
    expect(screen.getByText(/mapping the org graph/i)).toBeInTheDocument();
  });

  it("shows error message from a thrown Error", async () => {
    listAgentsMock.mockRejectedValueOnce(new Error("network failure"));
    render(
      <MemoryRouter>
        <OrgStructure />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("network failure")).toBeInTheDocument());
  });

  it("shows fallback error message for non-Error throw", async () => {
    listAgentsMock.mockRejectedValueOnce("unexpected");
    render(
      <MemoryRouter>
        <OrgStructure />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByText(/failed to load org structure/i)).toBeInTheDocument(),
    );
  });

  it("shows auth error when token is null in authenticated mode", async () => {
    getAccessTokenMock.mockResolvedValueOnce(null);
    render(
      <MemoryRouter>
        <OrgStructure />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByText(/authentication session expired/i)).toBeInTheDocument(),
    );
  });

  it("shows empty state when no agents returned", async () => {
    listAgentsMock.mockResolvedValueOnce([]);
    render(
      <MemoryRouter>
        <OrgStructure />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /no team yet/i }),
      ).toBeInTheDocument(),
    );
    // "Define your first mission..." appears in both the page-head meta and
    // the EmptyState description — make sure at least one is rendered.
    expect(
      screen.getAllByText(/define your first mission to start hiring/i).length,
    ).toBeGreaterThan(0);
  });

  it("renders lead agent names when agents are returned", async () => {
    listAgentsMock.mockResolvedValueOnce([makeAgent({ id: "a1", name: "Alpha Bot" })]);
    render(
      <MemoryRouter>
        <OrgStructure />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Alpha Bot")).toBeInTheDocument());
  });

  it("builds hierarchy from reportingToAgentId metadata when no edges available", async () => {
    const manager = makeAgent({ id: "mgr", name: "Manager Bot", metadata: {} });
    const report = makeAgent({
      id: "rep",
      name: "Report Bot",
      metadata: { reportingToAgentId: "mgr" },
    });
    listAgentsMock.mockResolvedValueOnce([manager, report]);
    render(
      <MemoryRouter>
        <OrgStructure />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("Manager Bot")).toBeInTheDocument();
      expect(screen.getByText("Report Bot")).toBeInTheDocument();
    });
  });

  it("builds hierarchy from org-graph edges when present (HEL-118)", async () => {
    const ceo = makeAgent({ id: "ceo", name: "Chief Bot" });
    const ic = makeAgent({ id: "ic", name: "IC Bot" });
    listAgentsMock.mockResolvedValueOnce([ceo, ic]);
    trackedFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          workspaceId: "w1",
          agents: [],
          edges: [
            { id: "e1", managerAgentId: "ceo", agentId: "ic", createdAt: "now" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    render(
      <MemoryRouter>
        <OrgStructure />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Chief Bot")).toBeInTheDocument());
    expect(screen.getByText("IC Bot")).toBeInTheDocument();
  });

  it("renders the active mission card at the top when one exists", async () => {
    listAgentsMock.mockResolvedValueOnce([makeAgent({ id: "a1", name: "Lead Bot" })]);
    listMissionsMock.mockResolvedValueOnce([
      {
        id: "m1",
        statement: "Become the leader in industrial robotics",
        status: "active",
        metadata: {},
        createdAt: new Date().toISOString(),
        companyId: "c1",
        companyName: "Acme",
        latestHiringPlanId: "p1",
      },
    ]);
    render(
      <MemoryRouter>
        <OrgStructure />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(
        screen.getByText("Become the leader in industrial robotics"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/Acme · active/)).toBeInTheDocument();
  });

  it('shows the "No mission yet" fallback when there are agents but no missions', async () => {
    listAgentsMock.mockResolvedValueOnce([makeAgent({ id: "a1", name: "Lead Bot" })]);
    listMissionsMock.mockResolvedValueOnce([]);
    render(
      <MemoryRouter>
        <OrgStructure />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Lead Bot")).toBeInTheDocument());
    expect(screen.getByText(/no mission yet/i)).toBeInTheDocument();
  });

  it("renders the v2 page chrome (page, head, eyebrow, h1, card)", async () => {
    listAgentsMock.mockResolvedValueOnce([makeAgent({ id: "a1", name: "Solo Bot" })]);
    const { container } = render(
      <MemoryRouter>
        <OrgStructure />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Solo Bot")).toBeInTheDocument());
    expect(container.querySelector(".af2-page")).not.toBeNull();
    expect(container.querySelector(".af2-page-head")).not.toBeNull();
    expect(container.querySelector(".af2-eyebrow")).not.toBeNull();
    expect(container.querySelector("h1.af2-h1")).not.toBeNull();
    expect(container.querySelectorAll(".af2-card").length).toBeGreaterThan(0);
  });

  it("renders the 'Team' heading and 'Workforce' eyebrow", async () => {
    render(
      <MemoryRouter>
        <OrgStructure />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Team" })).toBeInTheDocument();
    expect(screen.getByText("Workforce")).toBeInTheDocument();
  });

  it("renders Org map / List view / Hire actions in the page head", async () => {
    // Use a non-empty agent list so the page-head Hire link is the only
    // hire link on the page (no EmptyState rendered).
    listAgentsMock.mockResolvedValueOnce([makeAgent({ id: "a1", name: "Solo Bot" })]);
    render(
      <MemoryRouter>
        <OrgStructure />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("button", { name: /org map/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /list view/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /hire/i })).toHaveAttribute("href", "/hire");
  });

  it("shows real spend from getAgentBudget when present", async () => {
    listAgentsMock.mockResolvedValueOnce([
      makeAgent({ id: "a1", name: "Cash Bot", budgetMonthlyUsd: 200 }),
    ]);
    getAgentBudgetMock.mockResolvedValueOnce(
      makeBudget({ agentId: "a1", monthlyUsd: 250, spentUsd: 117 }),
    );
    render(
      <MemoryRouter>
        <OrgStructure />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Cash Bot")).toBeInTheDocument());
    // Lead row: "<spent> / <budget>"
    expect(screen.getByText("$117")).toBeInTheDocument();
    expect(screen.getByText("/ $250")).toBeInTheDocument();
  });
});
