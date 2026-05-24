/**
 * HEL-105 — smoke coverage for the side-by-side hiring plan review page.
 *
 * Asserts the v2 chrome renders + the canonical sections (mission, plan
 * summary, agent cards, Confirm CTA) appear with the right copy.
 * Full confirm-flow + already-accepted state is covered by the backend
 * tests in src/missions/hiringPlanRoutes.test.ts.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HiringPlanResponse } from "../api/missionsApi";

const {
  getHiringPlanMock,
  confirmHiringPlanMock,
  patchHiringPlanSelectionMock,
  requireAccessTokenMock,
} = vi.hoisted(() => ({
  getHiringPlanMock: vi.fn(),
  confirmHiringPlanMock: vi.fn(),
  patchHiringPlanSelectionMock: vi.fn(),
  requireAccessTokenMock: vi.fn(),
}));

vi.mock("../api/missionsApi", () => ({
  getHiringPlan: getHiringPlanMock,
  confirmHiringPlan: confirmHiringPlanMock,
  patchHiringPlanSelection: patchHiringPlanSelectionMock,
  generateHiringPlan: vi.fn(),
}));

vi.mock("../api/client", () => ({
  getConnectorHealth: vi.fn().mockResolvedValue({ connectors: [] }),
  listLLMConfigs: vi.fn().mockResolvedValue([]),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "user@example.com", name: "Test User" },
    requireAccessToken: requireAccessTokenMock,
  }),
}));

import HiringPlanReview from "./HiringPlanReview";

function makeResponse(overrides: Partial<HiringPlanResponse> = {}): HiringPlanResponse {
  return {
    id: "plan-1",
    missionId: "mission-1",
    missionStatement: "Launch the R-7 to industrial buyers in NA by Q4.",
    plan: {
      schemaVersion: "2026-04-27",
      company: {
        name: "Acme Robotics",
        goal: "Become the leader in industrial robotics",
        targetCustomer: "OEM purchasing managers",
        budget: "$250k over 6 months",
        timeHorizon: "Q4",
      },
      summary: "Tight 3-person pod for launch.",
      rationale: "Focus the budget on demand gen + product narrative.",
      orgChart: {
        executives: [
          {
            roleKey: "ceo",
            title: "CEO",
            roleType: "executive",
            department: "executive",
            headcount: 1,
            reportsToRoleKey: null,
            mandate: "Set strategy.",
            justification: "Own outcomes.",
            kpis: ["Hit Q4 milestone"],
            skills: ["strategy"],
            tools: [],
            modelTier: "power",
            budgetMonthlyUsd: 500,
            provisioningInstructions: "Provision Opus.",
          },
        ],
        operators: [
          {
            roleKey: "sdr",
            title: "SDR",
            roleType: "operator",
            department: "sales",
            headcount: 1,
            reportsToRoleKey: "ceo",
            mandate: "Outbound to OEMs.",
            justification: "Drive pipeline.",
            kpis: ["200 demos"],
            skills: ["outbound"],
            tools: ["apollo"],
            modelTier: "lite",
            budgetMonthlyUsd: 80,
            provisioningInstructions: "Provision Haiku.",
          },
        ],
        reportingLines: [{ managerRoleKey: "ceo", reportRoleKey: "sdr" }],
      },
      provisioningPlan: {
        teamName: "R-7 Launch Pod",
        deploymentMode: "continuous_agents",
        agents: [
          {
            roleKey: "ceo",
            title: "CEO",
            roleType: "executive",
            department: "executive",
            headcount: 1,
            reportsToRoleKey: null,
            mandate: "Set strategy.",
            justification: "Own outcomes.",
            kpis: ["Hit Q4 milestone"],
            skills: ["strategy"],
            tools: [],
            modelTier: "power",
            budgetMonthlyUsd: 500,
            provisioningInstructions: "Provision Opus.",
          },
          {
            roleKey: "sdr",
            title: "SDR",
            roleType: "operator",
            department: "sales",
            headcount: 1,
            reportsToRoleKey: "ceo",
            mandate: "Outbound to OEMs.",
            justification: "Drive pipeline.",
            kpis: ["200 demos"],
            skills: ["outbound"],
            tools: ["apollo"],
            modelTier: "lite",
            budgetMonthlyUsd: 80,
            provisioningInstructions: "Provision Haiku.",
          },
        ],
      },
      roadmap306090: {
        day30: {
          objectives: ["Brand foundation"],
          deliverables: ["Site live"],
          ownerRoleKeys: ["ceo"],
        },
        day60: {
          objectives: ["First 50 demos"],
          deliverables: ["Pipeline > $200k"],
          ownerRoleKeys: ["sdr"],
        },
        day90: {
          objectives: ["30 design wins"],
          deliverables: ["Repeatable motion"],
          ownerRoleKeys: ["ceo", "sdr"],
        },
      },
    },
    acceptedAt: null,
    acceptedByUserId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={["/hire/plan/mission-1/plan-1"]}>
      <Routes>
        <Route path="/hire/plan/:missionId/:planId" element={<HiringPlanReview />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("HiringPlanReview (HEL-105)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAccessTokenMock.mockResolvedValue("mock-token");
    confirmHiringPlanMock.mockResolvedValue({
      hiringPlanId: "plan-1",
      missionId: "mission-1",
      acceptedAt: new Date().toISOString(),
      agents: [],
      orgEdges: [],
    });
    patchHiringPlanSelectionMock.mockImplementation(async (_id, keys) => ({
      plan: {
        ...makeResponse().plan,
        selection: { includedRoleKeys: keys },
      },
    }));
  });

  it("renders v2 page chrome", async () => {
    getHiringPlanMock.mockResolvedValueOnce(makeResponse());
    const { container } = renderRoute();
    await screen.findByRole("heading", { name: /Review hiring plan/i });

    expect(container.querySelector(".af2-page")).not.toBeNull();
    expect(container.querySelector(".af2-page-head")).not.toBeNull();
    expect(container.querySelector("h1.af2-h1")).not.toBeNull();
  });

  it("renders mission + plan side-by-side with agent cards", async () => {
    getHiringPlanMock.mockResolvedValueOnce(makeResponse());
    renderRoute();

    expect(
      await screen.findByText(/Launch the R-7 to industrial buyers/),
    ).toBeInTheDocument();
    // Plan rationale renders on the right.
    expect(screen.getByText(/Focus the budget on demand gen/)).toBeInTheDocument();
    // Agent cards render with their titles.
    expect(screen.getAllByText("CEO").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SDR").length).toBeGreaterThan(0);
    // 30/60/90 roadmap headers.
    expect(screen.getByText("Day 30")).toBeInTheDocument();
    expect(screen.getByText("Day 60")).toBeInTheDocument();
    expect(screen.getByText("Day 90")).toBeInTheDocument();
  });

  it("shows the Confirm CTA when not yet accepted", async () => {
    getHiringPlanMock.mockResolvedValueOnce(makeResponse());
    renderRoute();
    expect(
      await screen.findByRole("button", { name: /Confirm & provision agents/i }),
    ).toBeInTheDocument();
  });

  it("shows the confirmed-state card when acceptedAt is set", async () => {
    getHiringPlanMock.mockResolvedValueOnce(
      makeResponse({ acceptedAt: new Date().toISOString(), acceptedByUserId: "user-1" }),
    );
    renderRoute();

    await waitFor(() => {
      expect(screen.getByText(/Plan confirmed/i)).toBeInTheDocument();
    });
    // The team page link is in the confirmed-state card.
    expect(screen.getByRole("link", { name: /Team page/i })).toHaveAttribute(
      "href",
      "/workspace/org-structure",
    );
  });

  it("renders the seeded-routine CTAs after a successful confirm (HEL-154)", async () => {
    getHiringPlanMock
      .mockResolvedValueOnce(makeResponse())
      .mockResolvedValueOnce(
        makeResponse({ acceptedAt: new Date().toISOString(), acceptedByUserId: "user-1" }),
      );
    confirmHiringPlanMock.mockResolvedValueOnce({
      hiringPlanId: "plan-1",
      missionId: "mission-1",
      acceptedAt: new Date().toISOString(),
      agents: [
        {
          id: "agent-ceo",
          roleKey: "ceo",
          name: "CEO",
          modelTier: "power",
          model: null,
          budgetMonthlyUsd: 500,
          reportingToAgentId: null,
        },
        {
          id: "agent-sdr",
          roleKey: "sdr",
          name: "SDR",
          modelTier: "lite",
          model: null,
          budgetMonthlyUsd: 80,
          reportingToAgentId: "agent-ceo",
        },
      ],
      orgEdges: [{ managerAgentId: "agent-ceo", agentId: "agent-sdr" }],
      seededRoutines: [
        {
          id: "routine-ceo",
          agentId: "agent-ceo",
          name: "CEO morning check-in",
          scheduleCron: "0 9 * * 1-5",
          llmTier: "power",
        },
        {
          id: "routine-sdr",
          agentId: "agent-sdr",
          name: "SDR morning check-in",
          scheduleCron: "0 9 * * 1-5",
          llmTier: "lite",
        },
      ],
    });
    const user = userEvent.setup();
    renderRoute();

    await user.click(
      await screen.findByRole("button", { name: /Confirm & provision agents/i }),
    );

    // The "Default routines created" callout appears with one row per agent.
    expect(await screen.findByText(/Default routines created/i)).toBeInTheDocument();
    expect(screen.getByText(/CEO morning check-in/i)).toBeInTheDocument();
    expect(screen.getByText(/SDR morning check-in/i)).toBeInTheDocument();

    // Each row's "View routines" link deep-links to standing-tasks.
    const viewLinks = screen.getAllByRole("link", { name: /View routines/i });
    expect(viewLinks.length).toBe(2);
    expect(viewLinks[0]).toHaveAttribute("href", "/agents/agent-ceo/standing-tasks");
    expect(viewLinks[1]).toHaveAttribute("href", "/agents/agent-sdr/standing-tasks");

    // No Studio deep-link is rendered (HEL-154 deliberately drops the
    // synthetic-DAG approach in favor of prompt-backed routines).
    expect(
      screen.queryByRole("link", { name: /Create routine in Studio/i }),
    ).not.toBeInTheDocument();
  });

});
