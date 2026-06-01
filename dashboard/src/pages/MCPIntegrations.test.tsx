import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function catalogEntry(
  slug: string,
  name: string,
  category: string,
  overrides: Partial<{ supportsOAuth: boolean; supportsApiKey: boolean; logoDomain: string }> = {},
) {
  return {
    slug,
    name,
    description: `${name} integration`,
    category,
    icon: slug,
    logoDomain: overrides.logoDomain ?? `${slug}.com`,
    authKind: "oauth2_pkce",
    supportsOAuth: overrides.supportsOAuth ?? true,
    supportsApiKey: overrides.supportsApiKey ?? false,
    actionCount: 1,
    triggerCount: 0,
    verified: true,
  };
}

const catalogPayload = {
  catalog: [
    catalogEntry("slack", "Slack", "communication", { supportsApiKey: true }),
    catalogEntry("hubspot", "HubSpot", "crm", { supportsApiKey: true }),
    catalogEntry("linear", "Linear", "devtools", { supportsApiKey: true }),
    catalogEntry("sentry", "Sentry", "devtools"),
    catalogEntry("stripe", "Stripe", "finance", { supportsApiKey: true }),
    catalogEntry("notion", "Notion", "productivity", { supportsApiKey: true }),
  ],
  categories: ["communication", "crm", "devtools", "finance", "productivity"],
  total: 6,
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
    vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/integrations/catalog")) {
        return new Response(JSON.stringify(catalogPayload), { status: 200 });
      }
      if (url.endsWith("/integrations/status")) {
        return new Response(JSON.stringify({ providers: liveStatuses }), { status: 200 });
      }
      if (url.endsWith("/integrations/linear/connect-api-key")) {
        return new Response(JSON.stringify({ connection: { id: "linear-1" } }), {
          status: 201,
        });
      }
      return new Response(
        JSON.stringify({ error: `Unhandled integration test request: ${init?.method ?? "GET"} ${url}` }),
        { status: 500 },
      );
    });
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
      expect.arrayContaining(["Communication", "Developer Tools", "Finance"]),
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

  it("links API-key documentation from the provider-specific modal", async () => {
    renderHub();

    const linearName = await screen.findByText("Linear");
    const linearRow = linearName.closest(".af2-list-row") as HTMLElement | null;
    expect(linearRow).not.toBeNull();

    fireEvent.click(within(linearRow!).getByRole("button", { name: /api key/i }));

    const docsLink = await screen.findByRole("link", { name: /linear docs/i });
    expect(docsLink).toHaveAttribute(
      "href",
      "https://developers.linear.app/docs/graphql/working-with-the-graphql-api",
    );
  });

  it("connects API-key providers through the provider-specific connector route", async () => {
    const fetchMock = vi.mocked(global.fetch);
    renderHub();

    const linearName = await screen.findByText("Linear");
    const linearRow = linearName.closest(".af2-list-row") as HTMLElement | null;
    expect(linearRow).not.toBeNull();

    fireEvent.click(within(linearRow!).getByRole("button", { name: /api key/i }));
    fireEvent.change(await screen.findByLabelText(/linear api key/i), {
      target: { value: "lin_api_test" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save and connect/i }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input, init]) => {
          const url = String(input);
          return (
            url.endsWith("/api/integrations/linear/connect-api-key") &&
            init?.method === "POST" &&
            init?.body === JSON.stringify({ apiKey: "lin_api_test" })
          );
        }),
      ).toBe(true);
    });

    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/integrations/connections")),
    ).toBe(false);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
