import { render, screen, waitFor } from "@testing-library/react";
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
  requireAccessToken: vi.fn().mockResolvedValue("token-123"),
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

function renderHub() {
  return render(
    <MemoryRouter>
      <IntegrationsHub />
    </MemoryRouter>,
  );
}

describe("IntegrationsHub — V2 category-list rebuild (DASH-12/13/8)", () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiGetMock.mockResolvedValue({ servers: [] });
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ providers: liveStatuses }), { status: 200 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders V2 chrome (af2-page, af2-page-head, serif h1)", async () => {
    const { container } = renderHub();
    await waitFor(() => {
      expect(container.querySelector(".af2-page")).not.toBeNull();
    });
    expect(container.querySelector(".af2-page-head")).not.toBeNull();
    expect(container.querySelector(".af2-eyebrow")).not.toBeNull();
    expect(container.querySelector("h1.af2-h1")).not.toBeNull();
  });

  it("uses the editorial 'Connect · Integrations' eyebrow + 'Tools your agents can use' heading", async () => {
    renderHub();
    expect(await screen.findByText(/connect · integrations/i)).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /tools your agents can use/i,
      }),
    ).toBeInTheDocument();
  });

  it("renders providers grouped under permanent category headings (no card grid, no filter pills)", async () => {
    const { container } = renderHub();

    // Live providers from the catalog should appear by name.
    expect(await screen.findByText("Slack")).toBeInTheDocument();
    expect(await screen.findByText("Linear")).toBeInTheDocument();
    expect(await screen.findByText("HubSpot")).toBeInTheDocument();

    // Category eyebrows are rendered as <h3> on the page.
    const categoryHeadings = Array.from(
      container.querySelectorAll("h3.af2-eyebrow"),
    ).map((node) => node.textContent);
    expect(categoryHeadings).toEqual(
      expect.arrayContaining(["Communication", "Developer Tools", "Payments"]),
    );

    // The V1 filter-pill cluster is gone — categories are always-on sections.
    expect(container.querySelector(".af2-cluster")).toBeNull();
  });

  it("marks live-connected providers as 'Connected' and unconnected ones as 'Available'", async () => {
    renderHub();

    // Slack is connected per the mocked /status payload.
    await screen.findByText("Slack");
    expect(screen.getAllByText(/connected/i).length).toBeGreaterThan(0);

    // At least one "Available" pill should also exist (e.g., Apollo, HubSpot).
    expect(screen.getAllByText(/available/i).length).toBeGreaterThan(0);
  });

  it("links the 'Custom MCP server' CTA to the registry route", async () => {
    renderHub();
    const customCta = await screen.findAllByRole("link", {
      name: /custom mcp server/i,
    });
    expect(customCta.length).toBeGreaterThan(0);
    expect(customCta[0]).toHaveAttribute("href", "/settings/mcp-servers");
  });

  it("renders an OAuth 'Connect' button for OAuth-capable providers", async () => {
    renderHub();
    await screen.findByText("HubSpot"); // wait for hydration
    // HubSpot supports OAuth — there must be at least one Connect button on
    // the page (Slack is connected, so its row shows Disconnect instead).
    const connectButtons = screen.getAllByRole("button", { name: /^connect$/i });
    expect(connectButtons.length).toBeGreaterThan(0);
  });

  it("offers 'Set up via MCP' for providers without a live connector", async () => {
    renderHub();
    // Notion ships via custom MCP today (no liveProviderKey in the catalog).
    await screen.findByText("Notion");
    const mcpLinks = screen.getAllByRole("link", { name: /set up via mcp/i });
    expect(mcpLinks.length).toBeGreaterThan(0);
    expect(mcpLinks[0]).toHaveAttribute("href", "/settings/mcp-servers");
  });
});
