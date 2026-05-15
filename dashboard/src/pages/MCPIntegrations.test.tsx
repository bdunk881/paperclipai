import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    </MemoryRouter>
  );
}

describe("IntegrationsHub (v2)", () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiGetMock.mockResolvedValue({ servers: [] });
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ providers: liveStatuses }), { status: 200 })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders v2 chrome (af2-page, af2-page-head, af2-eyebrow, h1.af2-h1)", async () => {
    const { container } = renderHub();

    await waitFor(() => {
      expect(container.querySelector(".af2-page")).not.toBeNull();
    });
    expect(container.querySelector(".af2-page-head")).not.toBeNull();
    expect(container.querySelector(".af2-eyebrow")).not.toBeNull();
    expect(container.querySelector("h1.af2-h1")).not.toBeNull();
  });

  it("shows the 'Connect' eyebrow and 'Integrations' heading", async () => {
    const { container } = renderHub();
    await waitFor(() => {
      expect(container.querySelector(".af2-eyebrow")).not.toBeNull();
    });
    expect(container.querySelector(".af2-eyebrow")?.textContent).toBe("Connect");
    expect(
      await screen.findByRole("heading", { level: 1, name: /integrations/i })
    ).toBeInTheDocument();
  });

  it("renders integration cards", async () => {
    const { container } = renderHub();

    await waitFor(() => {
      expect(container.querySelectorAll(".af2-card").length).toBeGreaterThan(0);
    });
    expect(await screen.findByText("Slack")).toBeInTheDocument();
    expect(await screen.findByText("Linear")).toBeInTheDocument();
    expect(await screen.findByText("GitHub")).toBeInTheDocument();
  });

  it("renders category pills in an af2-cluster", async () => {
    const { container } = renderHub();

    await waitFor(() => {
      expect(container.querySelector(".af2-cluster")).not.toBeNull();
    });
    expect(container.querySelectorAll(".af2-cluster .af2-pill").length).toBeGreaterThan(1);
    expect(await screen.findByRole("button", { name: /^All \(/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /communication/i })).toBeInTheDocument();
  });

  it("marks live-connected providers as 'connected'", async () => {
    renderHub();

    // Wait for Slack card (which is connected per the mocked /status payload).
    await screen.findByText("Slack");
    // Slack lives in the Communication category — switch to it so we can isolate.
    await userEvent.click(screen.getByRole("button", { name: /communication/i }));

    expect(screen.getAllByText(/connected/i).length).toBeGreaterThan(0);
  });

  it("links the '+ Custom MCP server' CTA to the registry route", async () => {
    renderHub();

    const customCta = await screen.findByRole("link", { name: /custom mcp server/i });
    expect(customCta).toHaveAttribute("href", "/settings/mcp-servers");
  });

  it("filters cards by selected category", async () => {
    renderHub();

    await screen.findByText("Slack");
    await userEvent.click(screen.getByRole("button", { name: /^payments$/i }));

    expect(screen.getByText("Stripe")).toBeInTheDocument();
    expect(screen.queryByText("Slack")).not.toBeInTheDocument();
  });
});
