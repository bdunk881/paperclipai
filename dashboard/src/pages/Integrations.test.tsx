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

const connectedProviders = {
  apollo: { connected: true, connectedAt: "2026-01-01T00:00:00Z", scopes: ["read", "write", "enrich", "contacts", "extra"] },
  gmail: { connected: false },
  hubspot: { connected: false },
  sentry: { connected: false },
  slack: { connected: true, connectedAt: "2026-02-01T00:00:00Z", scopes: [] },
  stripe: { connected: false },
  composio: { connected: false },
};

describe("Integrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading state then renders provider cards on success", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: connectedProviders }), { status: 200 })
    );

    renderWithRouter();
    expect(screen.getByText("Loading connector status...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Apollo")).toBeInTheDocument();
    });
    expect(screen.getByText("Composio")).toBeInTheDocument();
    expect(screen.getAllByText("Not connected").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Connected").length).toBe(2);
  });

  it("shows error message when loadStatuses fails", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("Network fail"));

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("Network fail")).toBeInTheDocument();
    });
  });

  it("shows error from non-ok response body", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, statusText: "Unauthorized" })
    );

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("Unauthorized")).toBeInTheDocument();
    });
  });

  it("renders success callback banner", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: connectedProviders }), { status: 200 })
    );

    renderWithRouter("?status=success&provider=apollo");
    await waitFor(() => {
      expect(screen.getByText(/connected successfully/)).toBeInTheDocument();
    });
  });

  it("renders error callback banner with message", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: connectedProviders }), { status: 200 })
    );

    renderWithRouter("?status=error&provider=gmail&message=token+expired");
    await waitFor(() => {
      expect(screen.getByText(/connection failed/i)).toBeInTheDocument();
      expect(screen.getByText(/token expired/)).toBeInTheDocument();
    });
  });

  it("renders error callback banner without message", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: connectedProviders }), { status: 200 })
    );

    renderWithRouter("?status=error&provider=gmail");
    await waitFor(() => {
      expect(screen.getByText(/connection failed/i)).toBeInTheDocument();
    });
  });

  it("shows scopes for connected provider (max 4)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: connectedProviders }), { status: 200 })
    );

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("read")).toBeInTheDocument();
      expect(screen.getByText("write")).toBeInTheDocument();
      expect(screen.getByText("enrich")).toBeInTheDocument();
      expect(screen.getByText("contacts")).toBeInTheDocument();
    });
    expect(screen.queryByText("extra")).not.toBeInTheDocument();
  });

  it("shows 'No scopes recorded' for providers without scopes", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: connectedProviders }), { status: 200 })
    );

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getAllByText("No scopes recorded").length).toBeGreaterThan(0);
    });
  });

  it("shows 'Configure via API-key endpoint' for API-key providers", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: connectedProviders }), { status: 200 })
    );

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getAllByText("Configure via API-key endpoint").length).toBe(2);
    });
  });

  it("shows Disconnect button for connected providers", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: connectedProviders }), { status: 200 })
    );

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getAllByText("Disconnect").length).toBe(2);
    });
  });

  it("shows Connect button for disconnected OAuth providers", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: connectedProviders }), { status: 200 })
    );

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getAllByText("Connect").length).toBe(3);
    });
  });

  it("handleConnect initiates OAuth flow and redirects", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: connectedProviders }), { status: 200 })
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ redirectUrl: "https://oauth.example.com/auth" }), { status: 200 })
    );

    const assignMock = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignMock },
      writable: true,
    });

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getAllByText("Connect").length).toBe(3);
    });

    fireEvent.click(screen.getAllByText("Connect")[0]);

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith("https://oauth.example.com/auth");
    });
  });

  it("handleConnect shows error on failure", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: connectedProviders }), { status: 200 })
    );
    fetchMock.mockRejectedValueOnce(new Error("OAuth server down"));

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getAllByText("Connect").length).toBe(3);
    });

    fireEvent.click(screen.getAllByText("Connect")[0]);

    await waitFor(() => {
      expect(screen.getByText("OAuth server down")).toBeInTheDocument();
    });
  });

  it("handleConnect skips non-OAuth providers", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: connectedProviders }), { status: 200 })
    );

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getAllByText("Configure via API-key endpoint").length).toBe(2);
    });
    // Composio and Stripe have no Connect button because they use API-key mode.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("handleDisconnect calls API and reloads statuses", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: connectedProviders }), { status: 200 })
    );
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: { ...connectedProviders, apollo: { connected: false } } }), { status: 200 })
    );

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getAllByText("Disconnect").length).toBe(2);
    });

    fireEvent.click(screen.getAllByText("Disconnect")[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  it("handleDisconnect shows error on failure", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: connectedProviders }), { status: 200 })
    );
    fetchMock.mockRejectedValueOnce(new Error("Disconnect failed"));

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getAllByText("Disconnect").length).toBe(2);
    });

    fireEvent.click(screen.getAllByText("Disconnect")[0]);

    await waitFor(() => {
      expect(screen.getByText("Disconnect failed")).toBeInTheDocument();
    });
  });

  it("refresh button reloads statuses", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: connectedProviders }), { status: 200 })
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: connectedProviders }), { status: 200 })
    );

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("Apollo")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Refresh"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("renders connected-at timestamps and Not yet for unconnected", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: connectedProviders }), { status: 200 })
    );

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getAllByText("Not yet").length).toBeGreaterThan(0);
    });
  });

  it("calls fetch on mount to load statuses", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: connectedProviders }), { status: 200 })
    );

    renderWithRouter();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain("/api/integrations/status");
    });
  });

  it("handles non-ok response with unparseable JSON body", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("not json", { status: 500, statusText: "Internal Server Error" })
    );

    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("500 Internal Server Error")).toBeInTheDocument();
    });
  });
});
