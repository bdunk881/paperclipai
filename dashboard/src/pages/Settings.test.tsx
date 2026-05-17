/**
 * Settings page (HEL-32 v2 rebuild — tabbed surface) — tests.
 *
 * Asserts the v2 chrome (af2-page / af2-page-head / af2-h1), the
 * "Connect · Workspace" eyebrow, the tab strip, and that the General tab
 * surfaces Workspace + Approvals + Danger zone sections.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  listMissionsMock,
  requireAccessTokenMock,
  trackedFetchMock,
} = vi.hoisted(() => ({
  listMissionsMock: vi.fn(),
  requireAccessTokenMock: vi.fn(),
  trackedFetchMock: vi.fn(),
}));

vi.mock("../api/missionsApi", () => ({
  listMissions: listMissionsMock,
}));

vi.mock("../api/trackedFetch", () => ({
  trackedFetch: trackedFetchMock,
}));

vi.mock("../api/baseUrl", () => ({
  getApiBasePath: () => "/api",
  // settingsClient.ts evaluates getConfiguredApiOrigin() at import
  // time; stub it so the module loads cleanly under JSDOM (no
  // window.location to introspect).
  getConfiguredApiOrigin: () => "",
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "user@example.com", name: "Test User" },
    requireAccessToken: requireAccessTokenMock,
  }),
}));

vi.mock("../context/useWorkspace", () => ({
  useWorkspace: () => ({
    activeWorkspace: { id: "ws-1", name: "Acme Robotics", slug: "acme" },
    activeWorkspaceId: "ws-1",
  }),
}));

import Settings from "./Settings";

describe("Settings (v2 tabbed surface)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAccessTokenMock.mockResolvedValue("mock-token");
    listMissionsMock.mockResolvedValue([
      {
        id: "11111111-aaaa-bbbb-cccc-000000000001",
        statement: "Win Q3 by shipping the onboarding revamp",
        status: "in_flight",
        metadata: { successMetric: "100 signups" },
        createdAt: "2026-04-22T00:00:00.000Z",
        companyId: "company-1",
        companyName: "Acme Robotics",
        latestHiringPlanId: null,
      },
    ]);
    trackedFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        policies: [
          {
            id: "policy-1",
            workspaceId: "ws-1",
            actionType: "spend_above_threshold",
            mode: "require_approval",
            spendThresholdCents: 50000,
            createdAt: "2026-04-01T00:00:00.000Z",
            updatedAt: "2026-04-01T00:00:00.000Z",
          },
          {
            id: "policy-2",
            workspaceId: "ws-1",
            actionType: "code_merges_to_prod",
            mode: "require_approval",
            createdAt: "2026-04-01T00:00:00.000Z",
            updatedAt: "2026-04-01T00:00:00.000Z",
          },
        ],
        actionTypes: [],
        modes: [],
        total: 2,
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the v2 page chrome (af2-page / af2-page-head / af2-h1)", async () => {
    const { container } = render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Settings" })
    ).toBeInTheDocument();

    expect(container.querySelector(".af2-page")).not.toBeNull();
    expect(container.querySelector(".af2-page-head")).not.toBeNull();
    expect(container.querySelector(".af2-eyebrow")).not.toBeNull();
    expect(container.querySelector("h1.af2-h1")).not.toBeNull();
  });

  it("shows the Settings heading and the Connect · Workspace eyebrow", async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Settings" })
    ).toBeInTheDocument();
    expect(screen.getByText("Connect · Workspace")).toBeInTheDocument();
  });

  it("renders the tab strip (General / Members / Policies / Security / Billing / API)", async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    );

    await screen.findByRole("heading", { level: 1, name: "Settings" });

    for (const label of [
      "General",
      "Members",
      "Policies",
      "Security",
      "Billing",
      "API",
    ]) {
      expect(
        screen.getByRole("button", { name: label })
      ).toBeInTheDocument();
    }
  });

  it("renders Workspace, Approvals, and Danger zone sections on the General tab", async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    );

    // Workspace section
    expect(await screen.findByText("Workspace")).toBeInTheDocument();
    expect(screen.getByLabelText("Workspace name")).toHaveValue("Acme Robotics");
    expect(screen.getByLabelText("Mission statement")).toHaveValue(
      "Win Q3 by shipping the onboarding revamp"
    );
    expect(screen.getByLabelText("Default timezone")).toBeInTheDocument();
    // Save button gates on dirty state — present in the DOM, disabled
    // until the user edits something.
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();

    // Approvals
    expect(screen.getByText("Approvals")).toBeInTheDocument();
    // The seeded spend_above_threshold policy renders both a key ("Spend over $500")
    // and a value ("Always require human for spend over $500") — at least one match.
    expect(screen.getAllByText(/Spend over/i).length).toBeGreaterThan(0);
    // The code_merges_to_prod policy
    expect(screen.getByText("Production deploys")).toBeInTheDocument();

    // Danger zone
    expect(screen.getByText("Danger zone")).toBeInTheDocument();
    expect(screen.getByText("Pause all agents")).toBeInTheDocument();
    // DASH-16: "Pause all" button stays in the DOM but is disabled
    // ("Coming soon") until the bulk-pause backend lands.
    expect(
      screen.getByRole("button", { name: "Pause all" })
    ).toBeDisabled();
  });

  it("renders the workspace meta strap with the active workspace name", async () => {
    const { container } = render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    );

    await screen.findByRole("heading", { level: 1, name: "Settings" });

    const meta = container.querySelector(".af2-page-head-meta");
    expect(meta).not.toBeNull();
    expect(meta?.textContent).toContain("Acme Robotics");
  });

  it("switches to a hub tab when API is clicked", async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    );

    await screen.findByText("Workspace");

    fireEvent.click(screen.getByRole("button", { name: "API" }));

    // The API hub tab surfaces an "API keys" tile linking to /settings/api-keys.
    const apiKeysHeading = await screen.findByText("API keys");
    const apiKeysLink = apiKeysHeading.closest("a");
    expect(apiKeysLink).not.toBeNull();
    expect(apiKeysLink).toHaveAttribute("href", "/settings/api-keys");
  });

  it("renders the loading state before the API calls resolve", () => {
    listMissionsMock.mockReturnValue(new Promise(() => {}));
    trackedFetchMock.mockReturnValue(new Promise(() => {}));

    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    );

    expect(screen.getByText(/Loading workspace settings/i)).toBeInTheDocument();
  });

  it("renders the error state when the auth token can't be obtained", async () => {
    requireAccessTokenMock.mockRejectedValueOnce(new Error("no token"));

    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    );

    expect(await screen.findByText("Settings unavailable")).toBeInTheDocument();
  });

  it("opens the approval-policy editor when Edit is clicked and PUTs the new mode", async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    );

    await screen.findByRole("heading", { level: 1, name: "Settings" });

    // Two policies in the General tab's Approvals card; click the first Edit
    // button (Spend above threshold) to open the editor.
    const editButtons = await screen.findAllByRole("button", { name: /^Edit$/ });
    expect(editButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(editButtons[0]);

    // Modal opens. The dialog is labelled by the policy heading
    // ("Spend over $500" for the first policy).
    expect(
      await screen.findByRole("dialog", { name: /Spend over/i }),
    ).toBeInTheDocument();

    // Switch the mode to "Notify only" and save.
    fireEvent.click(screen.getByRole("radio", { name: /Notify only/i }));

    // Stub the PUT response.
    trackedFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        policy: {
          id: "policy-1",
          workspaceId: "ws-1",
          actionType: "spend_above_threshold",
          mode: "notify_only",
          spendThresholdCents: 50000,
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-05-16T00:00:00.000Z",
        },
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: /^Save policy$/ }));

    await waitFor(() => {
      // Modal closed.
      expect(screen.queryByRole("dialog", { name: /Spend over/i })).toBeNull();
    });

    // The PUT call should have hit /approval-policies/spend_above_threshold.
    const putCall = trackedFetchMock.mock.calls.find(([url, init]) => {
      const opts = init as { method?: string } | undefined;
      return (
        typeof url === "string" &&
        url.includes("/approval-policies/spend_above_threshold") &&
        opts?.method === "PUT"
      );
    });
    expect(putCall).toBeDefined();
  });
});
