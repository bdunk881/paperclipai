import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Layout from "./Layout";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "user@example.com", name: "Test User" },
    logout: vi.fn(),
  }),
}));

vi.mock("../context/useWorkspace", () => ({
  useWorkspace: () => ({
    workspaces: [{ id: "ws-1", name: "Acme Robotics", slug: "acme" }],
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

describe("Layout", () => {
  it("hides the app chrome for builder pop-out routes", () => {
    render(
      <MemoryRouter initialEntries={["/builder/tpl-1?popout=1"]}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route path="builder/:templateId" element={<div>Builder pop-out</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("Builder pop-out")).toBeInTheDocument();
    // Topbar is suppressed in pop-out mode.
    expect(screen.queryByTestId("app-topbar")).toBeNull();
    expect(screen.queryByRole("button", { name: /toggle navigation/i })).toBeNull();
  });

  it("renders the v2 four-pillar IA and marks Missions as active on /mission-state", () => {
    render(
      <MemoryRouter initialEntries={["/mission-state"]}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route path="mission-state" element={<div>Mission State content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    // Four-pillar section headers (HEL-31).
    expect(screen.getByText("Run")).toBeInTheDocument();
    expect(screen.getByText("Workforce")).toBeInTheDocument();
    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(screen.getByText("Connect")).toBeInTheDocument();

    // The Missions link (route is still /mission-state until HEL-23 lands the
    // mission-intake UI under its v2-native path) is active.
    expect(screen.getByRole("link", { name: "Missions" })).toHaveAttribute("aria-current", "page");
  });

  it("renders the v2 topbar with workspace switcher + global search + New mission CTA", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>Home content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId("app-topbar")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Switch workspace/i })
    ).toHaveTextContent("Acme Robotics");
    expect(
      screen.getByRole("searchbox", { name: /search agents, missions, tickets, runs/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /new mission/i })).toHaveAttribute(
      "href",
      "/hire"
    );
  });
});
