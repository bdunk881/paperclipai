import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import IntegrationsHub from "./MCPIntegrations";

const apiGetMock = vi.fn().mockResolvedValue({ servers: [] });

const mockedAuthContext = {
  user: { id: "test-user", email: "test@example.com", name: "Test User" },
  login: vi.fn(),
  signup: vi.fn(),
  logout: vi.fn(),
  getAccessToken: vi.fn().mockResolvedValue("mock-token"),
};

vi.mock("../context/AuthContext", () => ({
  useAuth: () => mockedAuthContext,
}));

vi.mock("../api/settingsClient", () => ({
  apiGet: (...args: unknown[]) => apiGetMock(...args),
}));

const liveStatuses = {
  slack: { connected: true },
  stripe: { connected: false },
};

describe("IntegrationsHub", () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiGetMock.mockResolvedValue({ servers: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes overlapping cards to the live connector setup surface", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: liveStatuses }), { status: 200 })
    );

    render(
      <MemoryRouter>
        <IntegrationsHub />
      </MemoryRouter>
    );

    expect(await screen.findByText("Slack")).toBeInTheDocument();
    expect(screen.getByText("cards with live setup already connected")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage connection" })).toHaveAttribute("href", "/integrations");
    expect(screen.getByRole("link", { name: "Open connector setup" })).toHaveAttribute("href", "/integrations");
  });

  it("renders a Linear integration card", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: liveStatuses }), { status: 200 })
    );

    render(
      <MemoryRouter>
        <IntegrationsHub />
      </MemoryRouter>
    );

    expect(await screen.findByText("Linear")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Sync projects and issues with Linear to automate triage, assignment, and status updates."
      )
    ).toBeInTheDocument();
    expect(screen.getAllByText("Linear")).toHaveLength(1);
  });

  it("replaces coming-soon marketplace language with explicit registry guidance", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: liveStatuses }), { status: 200 })
    );

    render(
      <MemoryRouter>
        <IntegrationsHub />
      </MemoryRouter>
    );

    expect(await screen.findByText("custom MCP servers registered")).toBeInTheDocument();
    expect(screen.getAllByText("Registry required").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Register server" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Register server" })[0]).toHaveAttribute(
      "href",
      "/settings/mcp-servers"
    );
    expect(screen.queryByText("4.9")).not.toBeInTheDocument();
    expect(screen.queryByText("4.8")).not.toBeInTheDocument();
    expect(screen.queryByText("Connect (coming soon)")).not.toBeInTheDocument();
  });
});
