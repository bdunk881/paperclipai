import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MissionState, { MissionStateView } from "./MissionState";

const authUser = { id: "user-1", email: "user@example.com", name: "User" };
const requireAccessTokenMock = vi.fn();
const apiGetMock = vi.fn();

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: authUser,
    requireAccessToken: requireAccessTokenMock,
  }),
}));

vi.mock("../api/settingsClient", () => ({
  apiGet: (...args: unknown[]) => apiGetMock(...args),
}));

beforeEach(() => {
  document.title = "AutoFlow";
  requireAccessTokenMock.mockReset();
  requireAccessTokenMock.mockResolvedValue("token-123");
  apiGetMock.mockReset();
});

describe("MissionStateView", () => {
  it("renders the canonical Mission State breadcrumb and title", () => {
    render(
      <MemoryRouter>
        <MissionStateView />
      </MemoryRouter>
    );

    expect(screen.getByText("Mission State")).toBeInTheDocument();
    expect(screen.getByText("Launch AutoFlow Beta")).toBeInTheDocument();
  });

  it("renders loading states for cards when requested", () => {
    render(
      <MemoryRouter>
        <MissionStateView states={{ health: "loading" }} />
      </MemoryRouter>
    );

    const skeletons = document.querySelectorAll(".animate-mission-skeleton");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders an empty state for the blockers card", () => {
    render(
      <MemoryRouter>
        <MissionStateView states={{ blockers: "empty" }} />
      </MemoryRouter>
    );

    expect(screen.getByText("Clear to proceed")).toBeInTheDocument();
  });

  it("renders an error state for the readiness card", () => {
    render(
      <MemoryRouter>
        <MissionStateView states={{ readiness: "error" }} />
      </MemoryRouter>
    );

    expect(screen.getByText("Readiness metrics could not be loaded.")).toBeInTheDocument();
  });
});

describe("MissionState route behavior", () => {
  it("loads mission-state data from the control-plane contract", async () => {
    apiGetMock
      .mockResolvedValueOnce({ teams: [{ id: "team-1", name: "Revenue Automation" }] })
      .mockResolvedValueOnce({
        missionState: {
          teamId: "team-1",
          title: "Revenue Automation",
          objective: "Launch an AI operations product",
          overallStatus: "blocked",
          currentPhase: null,
          ownerTeam: "Revenue Automation",
          staffingReadiness: { status: "ready", filledHeadcount: 2, plannedHeadcount: 2 },
          topBlockers: ["Resolve billing import blocker"],
          risks: [],
          nextMilestone: null,
          lastUpdated: "2026-04-30T03:24:09.699Z",
          fieldCoverage: {
            title: true,
            objective: true,
            overallStatus: true,
            currentPhase: false,
            ownerTeam: true,
            staffingReadiness: true,
            topBlockers: true,
            risks: true,
            nextMilestone: false,
            lastUpdated: true,
          },
        },
      });

    render(
      <MemoryRouter initialEntries={["/mission-state"]}>
        <Routes>
          <Route path="/mission-state" element={<MissionState />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { level: 1, name: "Revenue Automation" })).toBeInTheDocument();
    expect(await screen.findByText("Blocked")).toBeInTheDocument();
    expect(document.title).toBe("Mission State | AutoFlow");
  });

  it("shows the staffing-plan entry pill when deep-linked from staffing-plan", async () => {
    apiGetMock
      .mockResolvedValueOnce([{ id: "team-1", name: "Revenue Automation" }])
      .mockResolvedValueOnce({
        missionState: {
          teamId: "team-1",
          title: "Revenue Automation",
          objective: "Launch an AI operations product",
          overallStatus: "on_track",
          currentPhase: null,
          ownerTeam: "Revenue Automation",
          staffingReadiness: { status: "partial", filledHeadcount: 1, plannedHeadcount: 2 },
          topBlockers: [],
          risks: [],
          nextMilestone: null,
          lastUpdated: "2026-04-30T03:24:09.699Z",
          fieldCoverage: {
            title: true,
            objective: true,
            overallStatus: true,
            currentPhase: false,
            ownerTeam: true,
            staffingReadiness: true,
            topBlockers: true,
            risks: true,
            nextMilestone: false,
            lastUpdated: true,
          },
        },
      });

    render(
      <MemoryRouter initialEntries={["/mission-state?entry=staffing-plan"]}>
        <Routes>
          <Route path="/mission-state" element={<MissionState />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Opened from Staffing Plan")).toBeInTheDocument();
  });
});
