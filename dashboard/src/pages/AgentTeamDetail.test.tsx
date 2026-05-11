import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ControlPlaneAgent,
  ControlPlaneHeartbeatRecord,
  ControlPlaneTask,
  ControlPlaneTeamDetail,
} from "../api/client";
import AgentTeamDetailPage from "./AgentTeamDetail";

const { getControlPlaneTeamMock, getAccessTokenMock } = vi.hoisted(() => ({
  getControlPlaneTeamMock: vi.fn(),
  getAccessTokenMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  getControlPlaneTeam: getControlPlaneTeamMock,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ getAccessToken: getAccessTokenMock }),
}));

function makeAgent(overrides: Partial<ControlPlaneAgent> = {}): ControlPlaneAgent {
  return {
    id: "agent-1",
    teamId: "team-1",
    userId: "u1",
    name: "Alpha Agent",
    roleKey: "worker",
    instructions: "Do work",
    budgetMonthlyUsd: 10,
    schedule: { type: "manual" },
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeHeartbeat(overrides: Partial<ControlPlaneHeartbeatRecord> = {}): ControlPlaneHeartbeatRecord {
  return {
    id: "hb-1",
    teamId: "team-1",
    agentId: "agent-1",
    userId: "u1",
    status: "completed",
    createdTaskIds: [],
    startedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as ControlPlaneHeartbeatRecord;
}

function makeTask(overrides: Partial<ControlPlaneTask> = {}): ControlPlaneTask {
  return {
    id: "task-1",
    teamId: "team-1",
    userId: "u1",
    title: "Fix bug",
    assignedAgentId: "agent-1",
    status: "in_progress",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as ControlPlaneTask;
}

function makeDetail(overrides: Partial<ControlPlaneTeamDetail> = {}): ControlPlaneTeamDetail {
  return {
    team: {
      id: "team-1",
      userId: "u1",
      name: "Alpha Team",
      deploymentMode: "workflow_runtime",
      budgetMonthlyUsd: 100,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    } as ControlPlaneTeamDetail["team"],
    agents: [],
    tasks: [],
    heartbeats: [],
    ...overrides,
  };
}

function renderPage(teamId = "team-1", searchParams = "") {
  return render(
    <MemoryRouter initialEntries={[`/monitor/${teamId}${searchParams ? `?${searchParams}` : ""}`]}>
      <Routes>
        <Route path="/monitor/:teamId" element={<AgentTeamDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("AgentTeamDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccessTokenMock.mockResolvedValue("tok");
  });

  it("shows loading state initially", () => {
    getControlPlaneTeamMock.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/loading deployed team/i)).toBeInTheDocument();
  });

  it("shows error message from a thrown Error", async () => {
    getControlPlaneTeamMock.mockRejectedValueOnce(new Error("API down"));
    renderPage();
    await waitFor(() => expect(screen.getByText("API down")).toBeInTheDocument());
  });

  it("shows fallback error message for non-Error throw", async () => {
    getControlPlaneTeamMock.mockRejectedValueOnce("oops");
    renderPage();
    await waitFor(() => expect(screen.getByText(/failed to load deployed team/i)).toBeInTheDocument());
  });

  it("renders team name on successful load", async () => {
    getControlPlaneTeamMock.mockResolvedValueOnce(makeDetail());
    renderPage();
    await waitFor(() => expect(screen.getByText("Alpha Team")).toBeInTheDocument());
  });

  it("renders agent roster with heartbeat and task data", async () => {
    const agent = makeAgent({ id: "agent-1", name: "Beta Agent", schedule: { type: "interval", intervalMinutes: 15 } });
    const heartbeat = makeHeartbeat({ agentId: "agent-1", status: "running" });
    const task = makeTask({ assignedAgentId: "agent-1", status: "in_progress", title: "Fix bug" });
    getControlPlaneTeamMock.mockResolvedValueOnce(makeDetail({ agents: [agent], heartbeats: [heartbeat], tasks: [task] }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Beta Agent")).toBeInTheDocument();
      expect(screen.getByText("Fix bug")).toBeInTheDocument();
      expect(screen.getByText("15 min")).toBeInTheDocument();
    });
  });

  it("shows 'No open tasks assigned' when all tasks are done", async () => {
    const agent = makeAgent();
    const task = makeTask({ status: "done" });
    getControlPlaneTeamMock.mockResolvedValueOnce(makeDetail({ agents: [agent], tasks: [task] }));
    renderPage();
    await waitFor(() => expect(screen.getByText(/no open tasks assigned/i)).toBeInTheDocument());
  });

  it("highlights the agent card when ?agent= matches", async () => {
    const agent = makeAgent({ id: "agent-x", name: "Highlighted Agent" });
    getControlPlaneTeamMock.mockResolvedValueOnce(makeDetail({ agents: [agent] }));
    renderPage("team-1", "agent=agent-x");
    await waitFor(() => expect(screen.getByText("Highlighted Agent")).toBeInTheDocument());
  });

  it("shows 'no heartbeat' pill when agent has no heartbeat", async () => {
    const agent = makeAgent();
    getControlPlaneTeamMock.mockResolvedValueOnce(makeDetail({ agents: [agent] }));
    renderPage();
    await waitFor(() => expect(screen.getByText("no heartbeat")).toBeInTheDocument());
  });

  it("renders cron schedule format", async () => {
    const agent = makeAgent({ schedule: { type: "cron", cronExpression: "0 9 * * *" } });
    getControlPlaneTeamMock.mockResolvedValueOnce(makeDetail({ agents: [agent] }));
    renderPage();
    await waitFor(() => expect(screen.getByText("0 9 * * *")).toBeInTheDocument());
  });

  it("renders cron fallback when cronExpression is absent", async () => {
    const agent = makeAgent({ schedule: { type: "cron" } });
    getControlPlaneTeamMock.mockResolvedValueOnce(makeDetail({ agents: [agent] }));
    renderPage();
    await waitFor(() => expect(screen.getByText("cron")).toBeInTheDocument());
  });

  it("shows completed heartbeat status", async () => {
    const agent = makeAgent();
    const heartbeat = makeHeartbeat({ agentId: "agent-1", status: "completed" });
    getControlPlaneTeamMock.mockResolvedValueOnce(makeDetail({ agents: [agent], heartbeats: [heartbeat] }));
    renderPage();
    await waitFor(() => expect(screen.getByText("completed")).toBeInTheDocument());
  });

  it("uses the most recent heartbeat when multiple exist for the same agent", async () => {
    const agent = makeAgent();
    const old = makeHeartbeat({ id: "hb-old", agentId: "agent-1", status: "blocked", startedAt: "2026-01-01T00:00:00Z" });
    const recent = makeHeartbeat({ id: "hb-new", agentId: "agent-1", status: "completed", startedAt: "2026-01-02T00:00:00Z" });
    getControlPlaneTeamMock.mockResolvedValueOnce(makeDetail({ agents: [agent], heartbeats: [old, recent] }));
    renderPage();
    await waitFor(() => expect(screen.getByText("completed")).toBeInTheDocument());
  });

  it("ignores tasks without assignedAgentId", async () => {
    const agent = makeAgent();
    const unassigned = makeTask({ assignedAgentId: undefined, title: "Unassigned Task" });
    getControlPlaneTeamMock.mockResolvedValueOnce(makeDetail({ agents: [agent], tasks: [unassigned] }));
    renderPage();
    await waitFor(() => expect(screen.queryByText("Unassigned Task")).not.toBeInTheDocument());
  });
});
