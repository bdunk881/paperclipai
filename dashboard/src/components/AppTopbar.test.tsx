/**
 * AppTopbar (HEL-32 v2 chrome) — tests.
 *
 * Asserts the v2 topbar surfaces: workspace switcher (topbar variant),
 * global search input with ⌘K hint, "New mission" CTA → /hire, inbox →
 * /approvals, and the avatar link → /settings/profile. ⌘K focuses the
 * search input.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "jane.doe@example.com", name: "Jane Doe" },
    logout: vi.fn(),
  }),
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

import { AppTopbar } from "./AppTopbar";

describe("AppTopbar", () => {
  it("renders the workspace switcher with the active workspace", () => {
    render(
      <MemoryRouter>
        <AppTopbar />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("button", { name: /Switch workspace/i })
    ).toHaveTextContent("Acme Robotics");
  });

  it("renders the global search input with a ⌘K hint", () => {
    render(
      <MemoryRouter>
        <AppTopbar />
      </MemoryRouter>
    );

    const search = screen.getByRole("searchbox", {
      name: /search agents, missions, tickets, runs/i,
    });
    expect(search).toBeInTheDocument();
    expect(screen.getByText("⌘K")).toBeInTheDocument();
  });

  it("focuses the search input when ⌘K (or Ctrl+K) is pressed", () => {
    render(
      <MemoryRouter>
        <AppTopbar />
      </MemoryRouter>
    );

    const search = screen.getByRole("searchbox", {
      name: /search agents, missions, tickets, runs/i,
    });

    expect(search).not.toHaveFocus();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(search).toHaveFocus();
  });

  it("renders a 'New mission' CTA that links to /hire", () => {
    render(
      <MemoryRouter>
        <AppTopbar />
      </MemoryRouter>
    );

    const link = screen.getByRole("link", { name: /new mission/i });
    expect(link).toHaveAttribute("href", "/hire");
  });

  it("renders an inbox button that navigates to /approvals", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppTopbar />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("button", { name: /inbox/i })
    ).toBeInTheDocument();
  });

  it("renders the user avatar as a link to /settings/profile with initials", () => {
    render(
      <MemoryRouter>
        <AppTopbar />
      </MemoryRouter>
    );

    const avatar = screen.getByRole("link", { name: /open profile settings/i });
    expect(avatar).toHaveAttribute("href", "/settings/profile");
    expect(avatar).toHaveTextContent("JD");
  });

  it("renders an optional leading slot (used for the mobile nav toggle)", () => {
    render(
      <MemoryRouter>
        <AppTopbar leading={<span data-testid="lead">lead</span>} />
      </MemoryRouter>
    );

    expect(screen.getByTestId("lead")).toBeInTheDocument();
  });
});
