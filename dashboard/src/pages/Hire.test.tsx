/**
 * HEL-23 — input-validation + happy-path coverage for the mission intake
 * page. The page is the entry point of the customer loop (mission → plan →
 * agents → routine → run) so we assert: it renders v2 markers, the Save
 * button disables on empty input, structured-prompt fields capture metadata,
 * and submitting POSTs to /api/missions through the api client.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const {
  listMissionsMock,
  createMissionMock,
  generateHiringPlanMock,
  confirmHiringPlanMock,
  requireAccessTokenMock,
} = vi.hoisted(() => ({
  listMissionsMock: vi.fn(),
  createMissionMock: vi.fn(),
  generateHiringPlanMock: vi.fn(),
  confirmHiringPlanMock: vi.fn(),
  requireAccessTokenMock: vi.fn(),
}));

vi.mock("../api/missionsApi", () => ({
  listMissions: listMissionsMock,
  createMission: createMissionMock,
  generateHiringPlan: generateHiringPlanMock,
  confirmHiringPlan: confirmHiringPlanMock,
  getMission: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "user@example.com", name: "Test User" },
    requireAccessToken: requireAccessTokenMock,
  }),
}));

import Hire from "./Hire";

describe("Hire page (HEL-23)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAccessTokenMock.mockResolvedValue("mock-token");
    listMissionsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the v2 page-head copy", async () => {
    render(
      <MemoryRouter>
        <Hire />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: /Hire from a mission/i });
    expect(screen.getByText(/Workforce · Hiring/i)).toBeInTheDocument();
    expect(listMissionsMock).toHaveBeenCalledTimes(1);
  });

  it("disables both action buttons while the statement is empty", async () => {
    render(
      <MemoryRouter>
        <Hire />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: /Hire from a mission/i });
    const saveDraft = screen.getByRole("button", { name: /Save draft/i });
    const savePlan = screen.getByRole("button", { name: /Save & generate plan/i });
    expect(saveDraft).toBeDisabled();
    expect(savePlan).toBeDisabled();
  });

  it("submits a draft mission with statement + structured prompts", async () => {
    createMissionMock.mockResolvedValue({
      id: "mission-new",
      statement: "Launch the R-7",
      status: "draft",
      metadata: { industry: "Industrial robotics" },
      createdAt: new Date().toISOString(),
      companyId: "company-1",
      companyName: "Acme",
      latestHiringPlanId: null,
    });

    render(
      <MemoryRouter>
        <Hire />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: /Hire from a mission/i });

    fireEvent.change(screen.getByLabelText(/Mission statement/i), {
      target: { value: "Launch the R-7" },
    });
    fireEvent.change(screen.getByLabelText(/^Industry/i), {
      target: { value: "Industrial robotics" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save draft/i }));

    await waitFor(() => expect(createMissionMock).toHaveBeenCalledTimes(1));
    expect(createMissionMock).toHaveBeenCalledWith(
      {
        statement: "Launch the R-7",
        metadata: { industry: "Industrial robotics" },
      },
      "mock-token",
    );
    // After save the success banner appears.
    expect(await screen.findByText(/saved as a draft/i)).toBeInTheDocument();
  });

  it("calls generateHiringPlan after save when the user clicks Save & generate", async () => {
    createMissionMock.mockResolvedValue({
      id: "mission-new",
      statement: "Migrate the billing service",
      status: "draft",
      metadata: {},
      createdAt: new Date().toISOString(),
      companyId: "company-1",
      companyName: "Acme",
      latestHiringPlanId: null,
    });
    generateHiringPlanMock.mockResolvedValue({
      hiringPlanId: "plan-1",
      missionId: "mission-new",
      schemaVersion: 1,
      plan: {},
    });

    render(
      <MemoryRouter>
        <Hire />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: /Hire from a mission/i });

    fireEvent.change(screen.getByLabelText(/Mission statement/i), {
      target: { value: "Migrate the billing service" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save & generate plan/i }));

    await waitFor(() => expect(createMissionMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(generateHiringPlanMock).toHaveBeenCalledTimes(1));
    expect(generateHiringPlanMock).toHaveBeenCalledWith("mission-new", "mock-token");
    expect(await screen.findByText(/hiring plan generated/i)).toBeInTheDocument();
  });

  it("surfaces an error if the create call fails", async () => {
    createMissionMock.mockRejectedValue(new Error("Plan limit reached: missions"));
    render(
      <MemoryRouter>
        <Hire />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: /Hire from a mission/i });

    fireEvent.change(screen.getByLabelText(/Mission statement/i), {
      target: { value: "Test" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save draft/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Plan limit reached: missions/);
  });

  it("confirms a drafted hiring plan and refreshes the missions list (HEL-25)", async () => {
    listMissionsMock
      .mockResolvedValueOnce([
        {
          id: "m-with-plan",
          statement: "Launch the R-7 to industrial buyers",
          status: "draft",
          metadata: {},
          createdAt: new Date().toISOString(),
          companyId: "company-1",
          companyName: "Acme",
          latestHiringPlanId: "plan-xyz",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "m-with-plan",
          statement: "Launch the R-7 to industrial buyers",
          status: "active",
          metadata: {},
          createdAt: new Date().toISOString(),
          companyId: "company-1",
          companyName: "Acme",
          latestHiringPlanId: "plan-xyz",
        },
      ]);
    confirmHiringPlanMock.mockResolvedValue({
      hiringPlanId: "plan-xyz",
      missionId: "m-with-plan",
      acceptedAt: new Date().toISOString(),
      agents: [
        { id: "a-1", roleKey: "ceo", name: "CEO", modelTier: "power", model: null, budgetMonthlyUsd: 0, reportingToAgentId: null },
        { id: "a-2", roleKey: "sdr", name: "SDR", modelTier: "lite", model: null, budgetMonthlyUsd: 0, reportingToAgentId: "a-1" },
      ],
      orgEdges: [{ managerAgentId: "a-1", agentId: "a-2" }],
    });

    render(
      <MemoryRouter>
        <Hire />
      </MemoryRouter>,
    );

    const confirmButton = await screen.findByRole("button", { name: /Confirm plan/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(confirmHiringPlanMock).toHaveBeenCalledWith("plan-xyz", "mock-token");
    });

    // Success banner mentions both counts.
    expect(await screen.findByText(/provisioned 2 agents/i)).toBeInTheDocument();

    // After refresh the mission status flips to 'active' and the CTA
    // becomes "View team" linking to /team.
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /View team/i })).toHaveAttribute("href", "/team");
    });
  });

  it("renders saved missions returned by the API", async () => {
    listMissionsMock.mockResolvedValueOnce([
      {
        id: "m-existing",
        statement: "Onboard top-50 enterprise leads",
        status: "draft",
        metadata: {},
        createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
        companyId: "company-1",
        companyName: "Acme Robotics",
        latestHiringPlanId: null,
      },
    ]);
    render(
      <MemoryRouter>
        <Hire />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Onboard top-50 enterprise leads/)).toBeInTheDocument();
    expect(screen.getByText(/Acme Robotics/)).toBeInTheDocument();
  });

  it("uses af2 visual language (HEL-23 + HEL-99)", async () => {
    const { container } = render(
      <MemoryRouter>
        <Hire />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: /Hire from a mission/i });
    const heading = screen.getByRole("heading", { level: 1 });
    // HEL-99 structural marker: h1 carries af2-h1 (replaces the inline
    // text-4xl/font-normal/tracking pattern). font-af2-serif is kept as a
    // belt-and-suspenders class so anyone reading the markup still sees the
    // serif intent.
    expect(heading.className).toContain("af2-h1");
    expect(heading.className).toContain("font-af2-serif");
    // The outer wrapper is af2-page (HEL-99 chrome) and keeps text-af2-ink
    // so the h1 inherits ink color from the page.
    const outer = container.firstChild as HTMLElement;
    expect(outer.className).toContain("af2-page");
    expect(outer.className).toContain("text-af2-ink");
    // Page chrome structural markers present.
    expect(container.querySelector(".af2-page-head")).not.toBeNull();
    expect(container.querySelector(".af2-eyebrow")).not.toBeNull();
    // No regressions to legacy palettes.
    const html = container.innerHTML;
    expect(html).not.toMatch(/text-slate-(4|5|6|7|9)\d{2}/);
    expect(html).not.toMatch(/bg-white\b/);
    expect(html).not.toMatch(/bg-indigo-/);
  });
});
