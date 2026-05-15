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
        <MissionStateView
          data={{
            title: "Revenue Automation",
            objective: "Launch an AI operations product",
            overallStatus: "At Risk",
            phase: "Execution",
            phaseAvailable: true,
            ownerTeam: "Revenue Automation",
            lastUpdated: "April 30, 2026 at 3:16 AM ET",
            confidence: "Watch required",
            atRiskIndicator: "Billing import blocker is still open.",
            statusSummary: "The current mission-state contract reports active delivery risk.",
            staffingReadiness: "2/3 staffed",
            dependencyCountLabel: "Coverage pending",
            blockerCount: 1,
            activeWorkstreamsLabel: "Live",
            nextMilestone: "Coverage pending",
            nextMilestoneAvailable: false,
            topBlockers: ["Resolve billing import blocker"],
            recommendedActions: [],
            timeline: [],
          }}
        />
      </MemoryRouter>
    );

    // HEL-98 v2 restyle: breadcrumb removed in favor of af2-eyebrow above
    // the serif h1. The h1 itself still shows the mission title.
    expect(screen.getByText("Run · Missions")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Revenue Automation" })).toBeInTheDocument();
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

  it("contains no legacy slate-*/brand-*/teal-50/orange-50 palette refs (HEL-101)", () => {
    // Deep-pass regression guard. After PR #739 the chrome was v2 but the
    // six CardShell sections still used slate-* + brand-* + teal-50/orange-50
    // palettes. HEL-101 converts CardShell + every inline accent block to
    // af2 tones. This test fails if a future commit re-introduces any of
    // those legacy palette tokens anywhere in the rendered output.
    const { container } = render(
      <MemoryRouter>
        <MissionStateView
          data={{
            title: "Demo",
            objective: "Objective",
            overallStatus: "At Risk",
            phase: "Execution",
            phaseAvailable: true,
            ownerTeam: "Team",
            lastUpdated: "today",
            confidence: "Watch required",
            atRiskIndicator: "Demo risk",
            statusSummary: "Demo status",
            staffingReadiness: "1/2 staffed",
            dependencyCountLabel: "n/a",
            blockerCount: 1,
            activeWorkstreamsLabel: "Live",
            nextMilestone: "Demo milestone",
            nextMilestoneAvailable: true,
            topBlockers: ["a blocker"],
            recommendedActions: [
              { label: "Do thing", detail: "detail", to: "/x", kind: "primary" },
            ],
            timeline: [],
          }}
        />
      </MemoryRouter>
    );
    const html = container.innerHTML;
    // The grep guards: any class token starting with these legacy prefixes
    // signals a regression. `slate-y` (from translate-y-*) is allowed.
    expect(html).not.toMatch(/(?<!translate-)slate-(0|1|2|3|4|5|6|7|8|9)/);
    expect(html).not.toMatch(/\bbg-teal-50\b/);
    expect(html).not.toMatch(/\bbg-orange-50\b/);
    expect(html).not.toMatch(/\bbg-rose-(50|100)\b/);
    expect(html).not.toMatch(/\bbg-amber-(50|100)\b/);
    expect(html).not.toMatch(/\bbrand-\d/);
    expect(html).not.toMatch(/accent-(teal|orange)/);
  });

  it("renders with v2 structural markers (HEL-98)", () => {
    const { container } = render(
      <MemoryRouter>
        <MissionStateView
          data={{
            title: "Demo mission",
            objective: "Demo objective",
            overallStatus: "On Track",
            phase: "Execution",
            phaseAvailable: true,
            ownerTeam: "Demo Team",
            lastUpdated: "today",
            confidence: "High confidence",
            atRiskIndicator: "No blockers",
            statusSummary: "All good",
            staffingReadiness: "2/2 staffed",
            dependencyCountLabel: "n/a",
            blockerCount: 0,
            activeWorkstreamsLabel: "Live",
            nextMilestone: "Beta launch",
            nextMilestoneAvailable: true,
            topBlockers: [],
            recommendedActions: [],
            timeline: [],
          }}
        />
      </MemoryRouter>
    );

    expect(container.querySelector(".af2-page")).not.toBeNull();
    expect(container.querySelector(".af2-page-head")).not.toBeNull();
    expect(container.querySelector(".af2-eyebrow")).not.toBeNull();
    expect(container.querySelector("h1.af2-h1")).not.toBeNull();
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

    // HEL-98 v2 restyle: copy shortened, moved to af2-pill in the action row.
    expect(await screen.findByText(/from staffing plan/i)).toBeInTheDocument();
  });
});
