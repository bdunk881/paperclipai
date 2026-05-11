import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, Routine } from "../api/agentApi";
import Routines from "./Routines";

const { listAgentsMock, listRoutinesMock, getAccessTokenMock } = vi.hoisted(() => ({
  listAgentsMock: vi.fn(),
  listRoutinesMock: vi.fn(),
  getAccessTokenMock: vi.fn(),
}));

vi.mock("../api/agentApi", () => ({
  listAgents: listAgentsMock,
  listRoutines: listRoutinesMock,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ getAccessToken: getAccessTokenMock }),
}));

function makeRoutine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: "r1",
    userId: "u1",
    agentId: "a1",
    name: "Daily Report",
    scheduleType: "interval",
    intervalMinutes: 30,
    status: "active",
    metadata: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    name: "My Agent",
    description: "",
    status: "active",
    teamId: "team-1",
    ...overrides,
  } as Agent;
}

describe("Routines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccessTokenMock.mockResolvedValue("tok");
  });

  // ---------------------------------------------------------------------------
  // Loading / error states
  // ---------------------------------------------------------------------------

  it("shows loading state initially", () => {
    listAgentsMock.mockReturnValue(new Promise(() => {}));
    listRoutinesMock.mockReturnValue(new Promise(() => {}));
    render(<MemoryRouter><Routines /></MemoryRouter>);
    expect(screen.getByText(/loading routines/i)).toBeInTheDocument();
  });

  it("shows error when getAccessToken returns null", async () => {
    getAccessTokenMock.mockResolvedValueOnce(null);
    render(<MemoryRouter><Routines /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/authentication session expired/i)).toBeInTheDocument());
  });

  it("shows error message from thrown Error", async () => {
    listAgentsMock.mockRejectedValueOnce(new Error("API unavailable"));
    listRoutinesMock.mockResolvedValueOnce([]);
    render(<MemoryRouter><Routines /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("API unavailable")).toBeInTheDocument());
  });

  it("shows fallback error message for non-Error throw", async () => {
    listAgentsMock.mockRejectedValueOnce("string error");
    listRoutinesMock.mockResolvedValueOnce([]);
    render(<MemoryRouter><Routines /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/failed to load routines/i)).toBeInTheDocument());
  });

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------

  it("shows empty state when no routines are returned", async () => {
    listAgentsMock.mockResolvedValueOnce([]);
    listRoutinesMock.mockResolvedValueOnce([]);
    render(<MemoryRouter><Routines /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/no routines online yet/i)).toBeInTheDocument());
  });

  // ---------------------------------------------------------------------------
  // formatTrigger branches
  // ---------------------------------------------------------------------------

  it("formats cron schedule trigger with expression", async () => {
    const routine = makeRoutine({ scheduleType: "cron", cronExpression: "0 9 * * *" });
    listAgentsMock.mockResolvedValueOnce([makeAgent()]);
    listRoutinesMock.mockResolvedValueOnce([routine]);
    render(<MemoryRouter><Routines /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("0 9 * * *")).toBeInTheDocument());
  });

  it("formats cron schedule trigger with fallback when expression is null", async () => {
    const routine = makeRoutine({ scheduleType: "cron", cronExpression: null });
    listAgentsMock.mockResolvedValueOnce([makeAgent()]);
    listRoutinesMock.mockResolvedValueOnce([routine]);
    render(<MemoryRouter><Routines /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Cron")).toBeInTheDocument());
  });

  it("formats interval schedule trigger", async () => {
    const routine = makeRoutine({ scheduleType: "interval", intervalMinutes: 15 });
    listAgentsMock.mockResolvedValueOnce([makeAgent()]);
    listRoutinesMock.mockResolvedValueOnce([routine]);
    render(<MemoryRouter><Routines /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Every 15 min")).toBeInTheDocument());
  });

  it("formats manual schedule trigger", async () => {
    const routine = makeRoutine({ scheduleType: "manual" });
    listAgentsMock.mockResolvedValueOnce([makeAgent()]);
    listRoutinesMock.mockResolvedValueOnce([routine]);
    render(<MemoryRouter><Routines /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText("Manual").length).toBeGreaterThanOrEqual(1));
  });

  // ---------------------------------------------------------------------------
  // nextRunLabel branches
  // ---------------------------------------------------------------------------

  it("shows 'Due now' when nextRunAt is within 1 minute", async () => {
    const soon = new Date(Date.now() + 30_000).toISOString();
    const routine = makeRoutine({ nextRunAt: soon });
    listAgentsMock.mockResolvedValueOnce([makeAgent()]);
    listRoutinesMock.mockResolvedValueOnce([routine]);
    render(<MemoryRouter><Routines /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Due now")).toBeInTheDocument());
  });

  it("shows 'In X min' when nextRunAt is more than 1 minute away", async () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    const routine = makeRoutine({ nextRunAt: future });
    listAgentsMock.mockResolvedValueOnce([makeAgent()]);
    listRoutinesMock.mockResolvedValueOnce([routine]);
    render(<MemoryRouter><Routines /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/in \d+ min/i)).toBeInTheDocument());
  });

  it("shows 'Cron managed' when no nextRunAt and scheduleType is cron", async () => {
    const routine = makeRoutine({ scheduleType: "cron", nextRunAt: null });
    listAgentsMock.mockResolvedValueOnce([makeAgent()]);
    listRoutinesMock.mockResolvedValueOnce([routine]);
    render(<MemoryRouter><Routines /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Cron managed")).toBeInTheDocument());
  });

  it("shows 'Pending schedule' when no nextRunAt and scheduleType is interval", async () => {
    const routine = makeRoutine({ scheduleType: "interval", nextRunAt: null });
    listAgentsMock.mockResolvedValueOnce([makeAgent()]);
    listRoutinesMock.mockResolvedValueOnce([routine]);
    render(<MemoryRouter><Routines /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Pending schedule")).toBeInTheDocument());
  });

  it("shows 'On demand' when no nextRunAt and scheduleType is manual", async () => {
    const routine = makeRoutine({ scheduleType: "manual", nextRunAt: null });
    listAgentsMock.mockResolvedValueOnce([makeAgent()]);
    listRoutinesMock.mockResolvedValueOnce([routine]);
    render(<MemoryRouter><Routines /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("On demand")).toBeInTheDocument());
  });

  // ---------------------------------------------------------------------------
  // formatDate branches
  // ---------------------------------------------------------------------------

  it("shows 'No runs yet' when lastRunAt is absent", async () => {
    const routine = makeRoutine({ lastRunAt: null });
    listAgentsMock.mockResolvedValueOnce([makeAgent()]);
    listRoutinesMock.mockResolvedValueOnce([routine]);
    render(<MemoryRouter><Routines /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("No runs yet")).toBeInTheDocument());
  });

  it("shows formatted date when lastRunAt is present", async () => {
    const routine = makeRoutine({ lastRunAt: "2026-01-15T10:00:00Z" });
    listAgentsMock.mockResolvedValueOnce([makeAgent()]);
    listRoutinesMock.mockResolvedValueOnce([routine]);
    render(<MemoryRouter><Routines /></MemoryRouter>);
    await waitFor(() => {
      const cells = screen.getAllByText(/2026/);
      expect(cells.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Detached agent (no matching agent for the routine)
  // ---------------------------------------------------------------------------

  it("shows 'Detached agent' when no agent matches the routine agentId", async () => {
    const routine = makeRoutine({ agentId: "unknown" });
    listAgentsMock.mockResolvedValueOnce([makeAgent({ id: "a1" })]);
    listRoutinesMock.mockResolvedValueOnce([routine]);
    render(<MemoryRouter><Routines /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Detached agent")).toBeInTheDocument());
  });
});
