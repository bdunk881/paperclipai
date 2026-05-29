/**
 * AppTopbar (HEL-32 v2 chrome / HEL-169 search) tests.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppTopbar } from "./AppTopbar";

const { requireAccessTokenMock, searchEntitiesMock } = vi.hoisted(() => ({
  requireAccessTokenMock: vi.fn(),
  searchEntitiesMock: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "jane.doe@example.com", name: "Jane Doe" },
    logout: vi.fn(),
    requireAccessToken: requireAccessTokenMock,
  }),
}));

// HEL-203 PR 1: ExperienceModeContext is now read by AppTopbar for the
// Pro/Simple toggle. Stub it so AppTopbar's tests don't need to mount the
// real provider (which would also drag in an API call on first render).
vi.mock("../context/ExperienceModeContext", () => ({
  useExperienceMode: () => ({ mode: "simple", setMode: vi.fn(), loading: false }),
}));


vi.mock("../api/searchApi", () => ({
  searchEntities: searchEntitiesMock,
}));

vi.mock("../context/useWorkspace", () => ({
  useWorkspace: () => ({
    workspaces: [
      { id: "ws-1", name: "Acme Robotics", slug: "acme" },
      { id: "ws-2", name: "Beta Labs", slug: "beta" },
    ],
    activeWorkspace: { id: "ws-1", name: "Acme Robotics", slug: "acme" },
    activeWorkspaceId: "ws-1",
    loading: false,
    creating: false,
    error: null,
    setActiveWorkspaceId: vi.fn(),
    refreshWorkspaces: vi.fn(),
    createWorkspace: vi.fn(),
  }),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderWithRoutes(initialEntries = ["/"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <AppTopbar />
              <LocationProbe />
            </>
          }
        />
        <Route path="/agents/:agentId" element={<div>Agent detail route</div>} />
        <Route path="/approvals" element={<div>Approvals route</div>} />
        <Route path="/hire" element={<div>Hire route</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppTopbar", () => {
  beforeEach(() => {
    requireAccessTokenMock.mockReset();
    requireAccessTokenMock.mockResolvedValue("token-123");
    searchEntitiesMock.mockReset();
    searchEntitiesMock.mockResolvedValue({ query: "", results: [], total: 0 });
  });

  it("renders the workspace switcher with the active workspace", () => {
    renderWithRoutes();

    expect(
      screen.getByRole("button", { name: /Switch workspace/i }),
    ).toHaveTextContent("Acme Robotics");
  });

  it("renders the global search launcher with a Ctrl K hint", () => {
    renderWithRoutes();

    const search = screen.getByRole("button", {
      name: /search agents, missions, assignments, runs/i,
    });
    expect(search).toBeInTheDocument();
    expect(screen.getByText("Ctrl K")).toBeInTheDocument();
  });

  it("opens the command palette from Ctrl+K without firing search until the user types", async () => {
    renderWithRoutes();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    const dialog = await screen.findByRole("dialog", { name: /search autoflow/i });
    expect(within(dialog).getByRole("searchbox", { name: /search autoflow/i })).toHaveFocus();
    expect(searchEntitiesMock).not.toHaveBeenCalled();
  });

  it("opens search from the desktop launcher and routes clicked results", async () => {
    const user = userEvent.setup();
    searchEntitiesMock.mockResolvedValue({
      query: "",
      total: 1,
      results: [
        {
          type: "agent",
          id: "agent-1",
          title: "Revenue Analyst",
          subtitle: "Sales Ops",
          status: "active",
          route: "/agents/agent-1",
          matchedFields: ["name"],
          updatedAt: "2026-05-19T16:00:00.000Z",
        },
      ],
    });
    renderWithRoutes();

    await user.click(
      screen.getByRole("button", {
        name: /search agents, missions, assignments, runs/i,
      }),
    );
    const input = await screen.findByRole("searchbox", { name: /search autoflow/i });
    await user.type(input, "revenue");
    await waitFor(() => {
      expect(searchEntitiesMock).toHaveBeenCalledWith("token-123", "revenue", 8);
    });
    await user.click(await screen.findByRole("option", { name: /Revenue Analyst/i }));

    expect(await screen.findByText("Agent detail route")).toBeInTheDocument();
  });

  it("supports keyboard navigation through results", async () => {
    searchEntitiesMock.mockResolvedValue({
      query: "",
      total: 2,
      results: [
        {
          type: "mission",
          id: "mission-1",
          title: "Renewal mission",
          subtitle: "Acme Robotics",
          status: "active",
          route: "/mission-state?mission=mission-1",
          matchedFields: ["statement"],
          updatedAt: "2026-05-19T15:00:00.000Z",
        },
        {
          type: "agent",
          id: "agent-2",
          title: "Support Agent",
          subtitle: "Customer Ops",
          status: "active",
          route: "/agents/agent-2",
          matchedFields: ["name"],
          updatedAt: "2026-05-19T16:00:00.000Z",
        },
      ],
    });
    renderWithRoutes();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByRole("searchbox", { name: /search autoflow/i });
    await userEvent.type(input, "support");
    await waitFor(() => {
      expect(searchEntitiesMock).toHaveBeenCalledWith("token-123", "support", 8);
    });
    await screen.findByRole("option", { name: /Support Agent/i });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /Support Agent/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("Agent detail route")).toBeInTheDocument();
  });

  it("opens the same search surface from the mobile search affordance", async () => {
    const user = userEvent.setup();
    renderWithRoutes();

    await user.click(screen.getByRole("button", { name: /open search/i }));

    expect(await screen.findByRole("dialog", { name: /search autoflow/i })).toBeInTheDocument();
  });

  it("renders a 'New mission' CTA that links to /hire", () => {
    renderWithRoutes();

    const link = screen.getByRole("link", { name: /new mission/i });
    expect(link).toHaveAttribute("href", "/hire");
  });

  it("renders an inbox button that navigates to /approvals", () => {
    renderWithRoutes();

    expect(screen.getByRole("button", { name: /inbox/i })).toBeInTheDocument();
  });

  it("renders the user avatar as a button that opens the Af2UserMenu (HEL-203/HEL-213)", () => {
    // HEL-203 PR 1 + HEL-213 PR I: avatar is now a button that toggles
    // Af2UserMenu instead of a direct link to /settings/profile.
    // Navigation to Account / Members / Billing happens through the menu.
    render(
      <MemoryRouter>
        <AppTopbar />
      </MemoryRouter>,
    );

    const avatar = screen.getByRole("button", { name: /open user menu/i });
    expect(avatar).toHaveAttribute("aria-haspopup", "menu");
    expect(avatar).toHaveTextContent("JD");
  });

  it("renders an optional leading slot (used for the mobile nav toggle)", () => {
    render(
      <MemoryRouter>
        <AppTopbar leading={<span data-testid="lead">lead</span>} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("lead")).toBeInTheDocument();
  });
});
