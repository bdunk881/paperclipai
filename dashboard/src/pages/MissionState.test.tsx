/**
 * Missions page (HEL-32 v2 rebuild) — tests.
 *
 * Asserts the v2 chrome (af2-page / af2-page-head / af2-h1), the
 * "Workforce · Missions" eyebrow, tab counters from `listMissions`, and
 * mission statements rendering in the 2-column card grid.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MissionState from "./MissionState";

const { listMissionsMock, requireAccessTokenMock } = vi.hoisted(() => ({
  listMissionsMock: vi.fn(),
  requireAccessTokenMock: vi.fn(),
}));

vi.mock("../api/missionsApi", () => ({
  listMissions: listMissionsMock,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "user@example.com", name: "Test User" },
    requireAccessToken: requireAccessTokenMock,
  }),
}));

vi.mock("../context/useWorkspace", () => ({
  useWorkspace: () => ({ activeWorkspaceId: "ws-1" }),
}));

describe("MissionState (v2 missions list)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAccessTokenMock.mockResolvedValue("mock-token");
    listMissionsMock.mockResolvedValue([
      {
        id: "11111111-aaaa-bbbb-cccc-000000000001",
        statement: "Launch Q3 product hunt campaign",
        status: "in_flight",
        metadata: { successMetric: "100 signups" },
        createdAt: "2026-04-20T00:00:00.000Z",
        companyId: "company-1",
        companyName: "Acme Robotics",
        latestHiringPlanId: "plan-1",
      },
      {
        id: "22222222-aaaa-bbbb-cccc-000000000002",
        statement: "Migrate billing service to Postgres 16",
        status: "blocked",
        metadata: {},
        createdAt: "2026-04-21T00:00:00.000Z",
        companyId: "company-1",
        companyName: "Acme Robotics",
        latestHiringPlanId: null,
      },
      {
        id: "33333333-aaaa-bbbb-cccc-000000000003",
        statement: "Draft brand voice guidelines",
        status: "review",
        metadata: { successMetric: "Approved by exec team" },
        createdAt: "2026-04-22T00:00:00.000Z",
        companyId: "company-1",
        companyName: "Acme Robotics",
        latestHiringPlanId: "plan-3",
      },
      {
        id: "44444444-aaaa-bbbb-cccc-000000000004",
        statement: "Q4 OKR planning sweep",
        status: "scheduled",
        metadata: {},
        createdAt: "2026-04-23T00:00:00.000Z",
        companyId: "company-1",
        companyName: "Acme Robotics",
        latestHiringPlanId: null,
      },
      {
        id: "55555555-aaaa-bbbb-cccc-000000000005",
        statement: "Ship onboarding revamp",
        status: "completed",
        metadata: {},
        createdAt: "2026-04-10T00:00:00.000Z",
        companyId: "company-1",
        companyName: "Acme Robotics",
        latestHiringPlanId: "plan-5",
      },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the v2 page chrome (af2-page / af2-page-head / af2-h1)", async () => {
    const { container } = render(
      <MemoryRouter>
        <MissionState />
      </MemoryRouter>
    );

    await screen.findByText("Launch Q3 product hunt campaign");

    expect(container.querySelector(".af2-page")).not.toBeNull();
    expect(container.querySelector(".af2-page-head")).not.toBeNull();
    expect(container.querySelector("h1.af2-h1")).not.toBeNull();
  });

  it("shows the Missions heading and the Workforce · Missions eyebrow", async () => {
    render(
      <MemoryRouter>
        <MissionState />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Missions" })
    ).toBeInTheDocument();
    expect(screen.getByText("Workforce · Missions")).toBeInTheDocument();
  });

  it("renders tab counters from the missions list", async () => {
    render(
      <MemoryRouter>
        <MissionState />
      </MemoryRouter>
    );

    // In-flight: in_flight (1) + blocked (1) = 2
    expect(await screen.findByText("In flight (2)")).toBeInTheDocument();
    // Review: review (1)
    expect(screen.getByText("Review (1)")).toBeInTheDocument();
    // Scheduled: scheduled (1)
    expect(screen.getByText("Scheduled (1)")).toBeInTheDocument();
    // Done: completed (1)
    expect(screen.getByText("Done (1)")).toBeInTheDocument();
    // All
    expect(screen.getByText("All")).toBeInTheDocument();
  });

  it("renders mission statements in the card grid (default in-flight tab)", async () => {
    render(
      <MemoryRouter>
        <MissionState />
      </MemoryRouter>
    );

    // Default tab is "In flight" → in_flight + blocked.
    expect(
      await screen.findByText("Launch Q3 product hunt campaign")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Migrate billing service to Postgres 16")
    ).toBeInTheDocument();
    // Should not show review/scheduled missions on the in-flight tab.
    expect(screen.queryByText("Draft brand voice guidelines")).toBeNull();
    expect(screen.queryByText("Q4 OKR planning sweep")).toBeNull();
  });

  it("switches mission list when the Review tab is clicked", async () => {
    render(
      <MemoryRouter>
        <MissionState />
      </MemoryRouter>
    );

    const reviewTab = await screen.findByText("Review (1)");
    fireEvent.click(reviewTab);

    expect(
      await screen.findByText("Draft brand voice guidelines")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Launch Q3 product hunt campaign")
    ).toBeNull();
  });

  it("renders the loading state before missions resolve", () => {
    listMissionsMock.mockReturnValue(new Promise(() => {}));

    render(
      <MemoryRouter>
        <MissionState />
      </MemoryRouter>
    );

    expect(screen.getByText(/Loading missions/i)).toBeInTheDocument();
  });

  it("renders the error state when the API call fails", async () => {
    listMissionsMock.mockRejectedValueOnce(new Error("missions failed"));

    render(
      <MemoryRouter>
        <MissionState />
      </MemoryRouter>
    );

    expect(await screen.findByText("Missions unavailable")).toBeInTheDocument();
  });
});
