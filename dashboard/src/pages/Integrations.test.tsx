import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Integrations from "./Integrations";

const getAccessTokenMock = vi.fn().mockResolvedValue("mock-token");

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "u@e.com", name: "U" },
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
    getAccessToken: getAccessTokenMock,
  }),
}));

function renderWithRouter(searchParams = "") {
  return render(
    <MemoryRouter initialEntries={[`/integrations${searchParams}`]}>
      <Integrations />
    </MemoryRouter>
  );
}

const providerConnections: Record<string, unknown[]> = {
  apollo: [{ id: "apollo-1", authMethod: "oauth2", createdAt: "2026-01-01T00:00:00Z", scopes: ["read", "write", "enrich", "contacts", "extra"], accountLabel: "Apollo SMB" }],
  gmail: [],
  hubspot: [],
  sentry: [],
  slack: [{ id: "slack-1", authMethod: "api_key", createdAt: "2026-02-01T00:00:00Z", scopes: [], tokenMasked: "****1234" }],
  stripe: [],
  composio: [],
};

function installFetchMock(options?: {
  failConnectionsFor?: string[];
  oauthUrl?: string;
  connectionsOverride?: Partial<Record<string, unknown[]>>;
}) {
  return vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const provider = url.match(/\/api\/integrations\/([^/]+)\//)?.[1];
    const connections = {
      ...providerConnections,
      ...(options?.connectionsOverride ?? {}),
    };

    if (options?.failConnectionsFor?.includes(provider ?? "") && url.endsWith("/connections")) {
      return new Response(JSON.stringify({ error: "provider down" }), { status: 502, statusText: "Bad Gateway" });
    }

    if (method === "GET" && url.endsWith("/connections") && provider) {
      return new Response(JSON.stringify({ connections: connections[provider] ?? [], total: (connections[provider] ?? []).length }), { status: 200 });
    }

    if (method === "POST" && url.endsWith("/oauth/start")) {
      return new Response(JSON.stringify({ authUrl: options?.oauthUrl ?? "https://oauth.example.com/auth" }), { status: 201 });
    }

    if (method === "POST" && url.endsWith("/connect-api-key")) {
      return new Response(JSON.stringify({ connection: { id: `${provider}-new` } }), { status: 201 });
    }

    if (method === "DELETE" && /\/connections\/[^/]+$/.test(url)) {
      return new Response(null, { status: 204 });
    }

    return new Response(JSON.stringify({ error: `Unhandled ${method} ${url}` }), { status: 500 });
  });
}

describe("Integrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading state then renders provider cards from connector routes", async () => {
    installFetchMock();

    renderWithRouter();
    expect(screen.getByText("Loading connector status...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Apollo")).toBeInTheDocument();
    });

    expect(screen.getByText("Composio")).toBeInTheDocument();
    expect(screen.getAllByText("Connected").length).toBe(2);
    expect(screen.getAllByText("Not connected").length).toBeGreaterThan(0);
  });

  it("renders success callback banner", async () => {
    installFetchMock();

    renderWithRouter("?status=success&provider=apollo");
    await waitFor(() => {
      expect(screen.getByText(/connected successfully/)).toBeInTheDocument();
    });
  });

  it("shows a partial-load error when one connector status request fails", async () => {
    installFetchMock({ failConnectionsFor: ["hubspot"] });

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText(/Some connector statuses failed to load/i)).toBeInTheDocument();
    });
  });

  it("shows scopes for connected provider (max 4)", async () => {
    installFetchMock();

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("read")).toBeInTheDocument();
      expect(screen.getByText("write")).toBeInTheDocument();
      expect(screen.getByText("enrich")).toBeInTheDocument();
      expect(screen.getByText("contacts")).toBeInTheDocument();
    });

    expect(screen.queryByText("extra")).not.toBeInTheDocument();
  });

  it("shows hybrid auth labels and API-key-only labels", async () => {
    installFetchMock();

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getAllByText("OAuth + API key").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("API key").length).toBeGreaterThan(0);
  });

  it("starts OAuth from the provider-specific route", async () => {
    const fetchMock = installFetchMock();
    const assignMock = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignMock },
      writable: true,
    });

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getAllByText("Connect").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByText("Connect")[0]);

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith("https://oauth.example.com/auth");
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/integrations/gmail/oauth/start"), expect.objectContaining({ method: "POST" }));
  });

  it("saves an API key through the provider-specific fallback route", async () => {
    const fetchMock = installFetchMock({
      connectionsOverride: {
        apollo: [],
      },
    });

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getAllByText("Use API key").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByText("Use API key")[0]);
    fireEvent.change(screen.getByLabelText("Apollo API key"), { target: { value: "apollo-key" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save API key" })[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/integrations/apollo/connect-api-key"),
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("disconnects the active provider-specific connection id", async () => {
    const fetchMock = installFetchMock();

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getAllByText("Disconnect").length).toBe(2);
    });

    fireEvent.click(screen.getAllByText("Disconnect")[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/integrations/apollo/connections/apollo-1"),
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  it("renders the API-key form by default for API-key-only connectors", async () => {
    installFetchMock();

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByLabelText("Composio API key")).toBeInTheDocument();
    });
  });

  it("refresh button reloads statuses", async () => {
    const fetchMock = installFetchMock();

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("Apollo")).toBeInTheDocument();
    });

    const initialCalls = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByText("Refresh"));

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });
});
