import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import IntegrationMarketplace from "./IntegrationMarketplace";

const getAccessTokenMock = vi.fn().mockResolvedValue("marketplace-token");

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "u1@example.com", name: "User One" },
    logout: vi.fn(),
    getAccessToken: getAccessTokenMock,
    requireAccessToken: vi.fn().mockResolvedValue("marketplace-token"),
  }),
}));

function renderMarketplace() {
  return render(
    <MemoryRouter>
      <IntegrationMarketplace />
    </MemoryRouter>
  );
}

function installFetchMock(options?: {
  connectedProviders?: string[];
  connectRedirectUrl?: string;
}) {
  const connectedProviders = new Set(
    options?.connectedProviders ?? ["slack", "hubspot", "stripe", "linear", "sentry", "teams"]
  );

  return vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (method === "GET" && url.endsWith("/api/integrations/status")) {
      return new Response(
        JSON.stringify({
          providers: Object.fromEntries(
            ["apollo", "gmail", "hubspot", "linear", "sentry", "slack", "stripe", "teams"].map((provider) => [
              provider,
              { connected: connectedProviders.has(provider) },
            ])
          ),
        }),
        { status: 200 }
      );
    }

    if (method === "POST" && url.endsWith("/api/integrations/slack/connect")) {
      return new Response(
        JSON.stringify({ redirectUrl: options?.connectRedirectUrl ?? "https://oauth.example.com/slack" }),
        { status: 201 }
      );
    }

    if (method === "DELETE" && url.endsWith("/api/integrations/slack/disconnect")) {
      connectedProviders.delete("slack");
      return new Response(null, { status: 204 });
    }

    return new Response(JSON.stringify({ error: `Unhandled ${method} ${url}` }), { status: 500 });
  });
}

describe("IntegrationMarketplace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    getAccessTokenMock.mockResolvedValue("marketplace-token");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("filters integrations by search and category, then clears the empty state", () => {
    installFetchMock();
    renderMarketplace();

    expect(screen.getByText(/browse and connect/i)).toBeInTheDocument();
    expect(screen.getByText(/workflow templates/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /marketing \(/i }));

    expect(screen.getByText(/showing 14 of 162 integrations/i)).toBeInTheDocument();
    expect(screen.getByText("Mailchimp")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search integrations, categories, or actions/i), {
      target: { value: "nonexistent integration" },
    });

    expect(screen.getByText(/no integrations match your search/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));

    expect(screen.getByText(/showing 162 of 162 integrations/i)).toBeInTheDocument();
    expect(screen.getAllByText("Salesforce").length).toBeGreaterThan(0);
  });

  it("loads live status and uses the real OAuth/disconnect routes for supported providers", async () => {
    const fetchMock = installFetchMock();
    const assignMock = vi.spyOn(window.location, "assign").mockImplementation(() => {});

    renderMarketplace();

    const listButton = screen.getAllByRole("button").find((button) => button.querySelector("svg.lucide-list"));
    if (!listButton) throw new Error("List mode button not found");
    fireEvent.click(listButton);

    fireEvent.click(screen.getAllByText("Slack").at(-1) as HTMLElement);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Slack" })).toBeInTheDocument();
    });

    expect(screen.getAllByText(/lead capture to crm/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/this integration is authenticated and ready to use/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^disconnect$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^disconnect$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/integrations/slack/disconnect"),
        expect.objectContaining({ method: "DELETE" })
      );
    });
    expect(screen.getByText(/click connect below to launch the live oauth flow/i)).toBeInTheDocument();
    expect(screen.getByText(/not connected/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^connect$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^connect$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/integrations/slack/connect"),
        expect.objectContaining({ method: "POST" })
      );
      expect(assignMock).toHaveBeenCalledWith("https://oauth.example.com/slack");
    });
    expect(screen.getByText(/this integration is authenticated and ready to use/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^disconnect$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^disconnect$/i }));
    expect(screen.getByText(/not connected/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^connect$/i })).toBeInTheDocument();

    const closeButton = screen.getAllByRole("button").find((button) => button.querySelector("svg.lucide-x"));
    if (!closeButton) throw new Error("Drawer close button not found");
    fireEvent.click(closeButton);

    expect(screen.queryByRole("heading", { name: "Slack" })).not.toBeInTheDocument();
  });

  it("hides templates, supports search by action, and blocks unsupported connectors from faking a live flow", async () => {
    installFetchMock();
    renderMarketplace();

    fireEvent.click(screen.getByRole("button", { name: /templates/i }));
    expect(screen.queryByText(/workflow templates/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search integrations, categories, or actions/i), {
      target: { value: "write_range" },
    });

    expect(screen.getByText(/showing 1 of 162 integrations/i)).toBeInTheDocument();
    expect(screen.getAllByText("Google Sheets").length).toBeGreaterThan(0);
    expect(screen.queryByText("Salesforce")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search integrations, categories, or actions/i), {
      target: { value: "salesforce" },
    });

    fireEvent.click(screen.getAllByText("Salesforce").at(-1) as HTMLElement);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Salesforce" })).toBeInTheDocument();
    });
    expect(screen.getByText(/live connector setup is not available for this integration yet/i)).toBeInTheDocument();

    const unavailableButton = screen.getByRole("button", { name: /coming soon/i });
    expect(unavailableButton).toBeDisabled();
  });
});
