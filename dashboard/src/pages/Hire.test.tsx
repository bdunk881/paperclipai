/**
 * HEL-23 — mission intake page tests (v2 refresh).
 *
 * Covers the v2 page chrome ("Hire from a mission." headline, Workforce ·
 * Hiring eyebrow, mission textarea, Generate-hiring-plan CTA, Past missions
 * list) plus the existing data flow (createMission, generateHiringPlan,
 * Review-plan link routing). After a successful generate the page navigates
 * to /hire/plan/:missionId/:planId — HiringPlanReview owns the review
 * surface, not this page.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const {
  listMissionsMock,
  createMissionMock,
  generateHiringPlanMock,
  confirmHiringPlanMock,
  listLLMConfigsMock,
  requireAccessTokenMock,
} = vi.hoisted(() => ({
  listMissionsMock: vi.fn(),
  createMissionMock: vi.fn(),
  generateHiringPlanMock: vi.fn(),
  confirmHiringPlanMock: vi.fn(),
  listLLMConfigsMock: vi.fn(),
  requireAccessTokenMock: vi.fn(),
}));

vi.mock("../api/missionsApi", () => ({
  listMissions: listMissionsMock,
  createMission: createMissionMock,
  generateHiringPlan: generateHiringPlanMock,
  confirmHiringPlan: confirmHiringPlanMock,
  getMission: vi.fn(),
}));

vi.mock("../api/client", () => ({
  listLLMConfigs: listLLMConfigsMock,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "user@example.com", name: "Test User" },
    requireAccessToken: requireAccessTokenMock,
  }),
}));

import Hire from "./Hire";

function renderHire() {
  return render(
    <MemoryRouter initialEntries={["/hire"]}>
      <Routes>
        <Route path="/hire" element={<Hire />} />
        {/* Stub for the review page so the post-generate navigate has a
            target. The text is asserted by the navigate test below. */}
        <Route
          path="/hire/plan/:missionId/:planId"
          element={<div>plan review stub</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Hire page (HEL-23, v2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAccessTokenMock.mockResolvedValue("mock-token");
    listMissionsMock.mockResolvedValue([]);
    // Default to "user has at least one LLM credential" so the Generate
    // button is enabled across most tests. The no-LLM gate test below
    // explicitly overrides this with an empty array.
    listLLMConfigsMock.mockResolvedValue([
      {
        id: "cfg-1",
        label: "OpenAI",
        provider: "openai",
        model: "gpt-4o",
        isDefault: true,
        apiKeyMasked: "sk-…",
        createdAt: "2026-05-01T00:00:00Z",
      },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the v2 page-head copy", async () => {
    renderHire();
    await screen.findByRole("heading", { name: /Hire from a mission/i });
    expect(screen.getByText(/Workforce · Hiring/i)).toBeInTheDocument();
    expect(listMissionsMock).toHaveBeenCalledTimes(1);
  });

  it("renders the mission textarea + Generate hiring plan CTA", async () => {
    renderHire();
    await screen.findByRole("heading", { name: /Hire from a mission/i });
    expect(screen.getByLabelText(/Mission statement/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Generate hiring plan/i }),
    ).toBeInTheDocument();
  });

  it("disables both action buttons while the statement is empty", async () => {
    renderHire();
    await screen.findByRole("heading", { name: /Hire from a mission/i });
    const saveDraft = screen.getByRole("button", { name: /Save draft/i });
    const generate = screen.getByRole("button", { name: /Generate hiring plan/i });
    expect(saveDraft).toBeDisabled();
    expect(generate).toBeDisabled();
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

    renderHire();
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
    expect(await screen.findByText(/saved as a draft/i)).toBeInTheDocument();
  });

  it("blocks Generate with an inline call-out when no LLM model is connected", async () => {
    listLLMConfigsMock.mockResolvedValueOnce([]);
    renderHire();
    await screen.findByRole("heading", { name: /Hire from a mission/i });

    // Inline call-out renders with a clear next step.
    expect(
      await screen.findByText(/Connect a model before you can generate/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Add a model/i })).toHaveAttribute(
      "href",
      "/settings/llm-providers",
    );

    // The Generate button is disabled even with a populated mission statement.
    const textarea = screen.getByLabelText(/Mission statement/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Test mission" } });
    const generate = screen.getByRole("button", { name: /Generate hiring plan/i });
    expect(generate).toBeDisabled();
    expect(generateHiringPlanMock).not.toHaveBeenCalled();
  });

  it("calls generateHiringPlan and navigates to the review page", async () => {
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

    renderHire();
    await screen.findByRole("heading", { name: /Hire from a mission/i });

    fireEvent.change(screen.getByLabelText(/Mission statement/i), {
      target: { value: "Migrate the billing service" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate hiring plan/i }));

    await waitFor(() => expect(createMissionMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(generateHiringPlanMock).toHaveBeenCalledTimes(1));
    expect(generateHiringPlanMock).toHaveBeenCalledWith("mission-new", "mock-token");
    // After a successful generate, the page navigates to the side-by-side
    // review surface (HEL-105). The Hire page itself does not render the
    // generated plan inline.
    expect(await screen.findByText(/plan review stub/i)).toBeInTheDocument();
  });

  it("surfaces an error if the create call fails", async () => {
    createMissionMock.mockRejectedValue(new Error("Plan limit reached: missions"));
    renderHire();
    await screen.findByRole("heading", { name: /Hire from a mission/i });

    fireEvent.change(screen.getByLabelText(/Mission statement/i), {
      target: { value: "Test" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save draft/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Plan limit reached: missions/);
  });

  it("links a drafted hiring plan to the side-by-side review page (HEL-105)", async () => {
    listMissionsMock.mockResolvedValueOnce([
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
    ]);

    renderHire();

    const reviewLink = await screen.findByRole("link", { name: /Review plan/i });
    expect(reviewLink).toHaveAttribute("href", "/hire/plan/m-with-plan/plan-xyz");
  });

  it("renders a 'View team' link when the mission is already active (HEL-105)", async () => {
    listMissionsMock.mockResolvedValueOnce([
      {
        id: "m-confirmed",
        statement: "Already provisioned mission",
        status: "active",
        metadata: {},
        createdAt: new Date().toISOString(),
        companyId: "company-1",
        companyName: "Acme",
        latestHiringPlanId: "plan-abc",
      },
    ]);

    renderHire();

    const teamLink = await screen.findByRole("link", { name: /View team/i });
    expect(teamLink).toHaveAttribute("href", "/team");
  });

  it("renders past missions returned by the API", async () => {
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
    renderHire();
    expect(await screen.findByText(/Past missions/i)).toBeInTheDocument();
    expect(await screen.findByText(/Onboard top-50 enterprise leads/)).toBeInTheDocument();
    expect(screen.getByText(/Acme Robotics/)).toBeInTheDocument();
  });

  it("uses af2 visual language (HEL-23 + HEL-99)", async () => {
    const { container } = renderHire();
    await screen.findByRole("heading", { name: /Hire from a mission/i });
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.className).toContain("af2-h1");
    expect(heading.className).toContain("font-af2-serif");
    const outer = container.firstChild as HTMLElement;
    expect(outer.className).toContain("af2-page");
    expect(outer.className).toContain("text-af2-ink");
    // Page chrome structural markers.
    expect(container.querySelector(".af2-page-head")).not.toBeNull();
    expect(container.querySelector(".af2-eyebrow")).not.toBeNull();
    expect(container.querySelector(".af2-card")).not.toBeNull();
    // Readiness pill is part of the v2 reference design.
    expect(container.querySelector(".af2-pill")).not.toBeNull();
    // No regressions to legacy palettes or dark-mode variants.
    const html = container.innerHTML;
    expect(html).not.toMatch(/text-slate-(4|5|6|7|9)\d{2}/);
    expect(html).not.toMatch(/bg-white\b/);
    expect(html).not.toMatch(/bg-indigo-/);
    expect(html).not.toMatch(/\bdark:/);
  });
});
