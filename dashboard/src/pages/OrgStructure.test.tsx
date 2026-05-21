import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "../api/agentApi";
import type { BudgetRow } from "../api/canonicalApi";
import OrgStructure from "./OrgStructure";

const {
  getAccessTokenMock,
  listAgentsMock,
  listMissionsMock,
  listBudgetsMock,
  getOrgGraphMock,
  accessModeMock,
} = vi.hoisted(() => ({
  getAccessTokenMock: vi.fn(),
  listAgentsMock: vi.fn(),
  listMissionsMock: vi.fn(),
  listBudgetsMock: vi.fn(),
  getOrgGraphMock: vi.fn(),
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
  getOrgGraph: getOrgGraphMock,
}));

vi.mock("../api/missionsApi", () => ({
  listMissions: listMissionsMock,
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

function makeBudgetRow(agentId: string, monthlyUsd: number, spentUsd: number): BudgetRow {
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

function mockOrgGraphEmpty() {
  getOrgGraphMock.mockResolvedValue({ workspaceId: "w1", agents: [], edges: [] });
}

describe("OrgStructure", () => {
  beforeEach(() => {
    getAccessTokenMock.mockReset();
    listAgentsMock.mockReset();
    listMissionsMock.mockReset();
    listBudgetsMock.mockReset();
    accessModeMock.mockReset();
    getOrgGraphMock.mockReset();
    accessModeMock.mockReturnValue("authenticated");
    getAccessTokenMock.mockResolvedValue("token-123");
    listAgentsMock.mockResolvedValue([]);
    listMissionsMock.mockResolvedValue([]);
    listBudgetsMock.mockResolvedValue([]);
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

  it("shows page chrome while agents are loading", () => {
    listAgentsMock.mockReturnValue(new Promise(() => {}));
    render(
      <MemoryRouter>
        <OrgStructure />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Team" })).toBeInTheDocument();
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
    listAgentsMock.mockRejectedValueOnce(new Error("unexpected"));
    render(
      <MemoryRouter>
        <OrgStructure />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByText(/unexpected/i)).toBeInTheDocument(),
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
    getOrgGraphMock.mockResolvedValueOnce({
      workspaceId: "w1",
      agents: [],
      edges: [{ id: "e1", managerAgentId: "ceo", agentId: "ic", createdAt: "now" }],
    });
    render(
      <MemoryRouter>
        <OrgStructure />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Chief Bot")).toBeInTheDocument());
    expect(screen.getByText("IC Bot")).toBeInTheDocument();
  });

  it("renders the selected mission card when missionId is in the URL", async () => {
    listAgentsMock.mockResolvedValueOnce([
      makeAgent({ id: "a1", name: "Lead Bot", metadata: { missionId: "m1" } }),
    ]);
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
      <MemoryRouter initialEntries={["/workspace/org-structure?missionId=m1"]}>
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

  it("shows workspace scope when there are agents but no missions", async () => {
    listAgentsMock.mockResolvedValueOnce([makeAgent({ id: "a1", name: "Lead Bot" })]);
    listMissionsMock.mockResolvedValueOnce([]);
    render(
      <MemoryRouter>
        <OrgStructure />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getAllByText("Lead Bot").length).toBeGreaterThan(0));
    expect(screen.getByText(/all missions/i)).toBeInTheDocument();
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

  it("renders enabled Org map / List view tabs and Hire link", async () => {
    listAgentsMock.mockResolvedValueOnce([makeAgent({ id: "a1", name: "Solo Bot" })]);
    render(
      <MemoryRouter>
        <OrgStructure />
      </MemoryRouter>,
    );
    const orgMap = await screen.findByRole("button", { name: /org map/i });
    const listView = screen.getByRole("button", { name: /list view/i });
    expect(orgMap).not.toBeDisabled();
    expect(listView).not.toBeDisabled();
    expect(orgMap.className).toContain("active");
    expect(screen.getByRole("link", { name: /hire/i })).toHaveAttribute("href", "/hire");
  });

  it("switches to list view when ?view=list", async () => {
    listAgentsMock.mockResolvedValueOnce([
      makeAgent({ id: "lead", name: "Lead Bot" }),
      makeAgent({ id: "rep", name: "Report Bot", metadata: { reportingToAgentId: "lead" } }),
    ]);
    render(
      <MemoryRouter initialEntries={["/workspace/org-structure?view=list"]}>
        <OrgStructure />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getAllByText("Lead Bot").length).toBeGreaterThan(0));
    expect(screen.getByText("Reports to")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /list view/i }).className).toContain("active");
  });

  it("filters agents by missionId metadata when mission is selected", async () => {
    listAgentsMock.mockResolvedValueOnce([
      makeAgent({ id: "a1", name: "Mission One Bot", metadata: { missionId: "m1" } }),
      makeAgent({ id: "a2", name: "Mission Two Bot", metadata: { missionId: "m2" } }),
    ]);
    listMissionsMock.mockResolvedValueOnce([
      {
        id: "m1",
        statement: "First mission",
        status: "active",
        metadata: {},
        createdAt: new Date().toISOString(),
        companyId: "c1",
        companyName: "Acme",
        latestHiringPlanId: null,
      },
      {
        id: "m2",
        statement: "Second mission",
        status: "draft",
        metadata: {},
        createdAt: new Date().toISOString(),
        companyId: "c1",
        companyName: "Acme",
        latestHiringPlanId: null,
      },
    ]);
    render(
      <MemoryRouter initialEntries={["/workspace/org-structure?missionId=m1"]}>
        <OrgStructure />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Mission One Bot")).toBeInTheDocument());
    expect(screen.queryByText("Mission Two Bot")).not.toBeInTheDocument();
  });

  it("shows real spend from /api/budgets when present", async () => {
    listAgentsMock.mockResolvedValueOnce([
      makeAgent({ id: "a1", name: "Cash Bot", budgetMonthlyUsd: 200 }),
    ]);
    listBudgetsMock.mockResolvedValueOnce([makeBudgetRow("a1", 250, 117)]);
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
