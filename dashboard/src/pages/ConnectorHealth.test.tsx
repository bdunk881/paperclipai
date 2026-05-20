/**
 * ConnectorHealth (HEL-179) — tests.
 *
 * The page consumes `getConnectorHealth()` and renders:
 *   - per-state count strip in the summary card
 *   - per-connector row with status pill + Reconnect CTA on auth_failed
 *   - severity-ordered list (auth_failed → healthy)
 *   - polling refresh every 30s
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getConnectorHealthMock, getAccessTokenMock } = vi.hoisted(() => ({
  getConnectorHealthMock: vi.fn(),
  getAccessTokenMock: vi.fn(),
}));

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    getConnectorHealth: getConnectorHealthMock,
  };
});

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "user@example.com", name: "User One" },
    getAccessToken: getAccessTokenMock,
  }),
}));

import ConnectorHealth from "./ConnectorHealth";
import type {
  ConnectorHealthRecord,
  ConnectorHealthState,
  ConnectorHealthSummary,
} from "../api/client";

function makeRecord(overrides: Partial<ConnectorHealthRecord>): ConnectorHealthRecord {
  return {
    connectorKey: "slack",
    connectorName: "Slack",
    state: "healthy",
    lastSuccessAt: "2026-05-20T03:00:00.000Z",
    lastErrorAt: null,
    lastErrorMessage: null,
    successRate24h: 99.8,
    authFailures15m: 0,
    rateLimitEvents15m: 0,
    transitions: [],
    source: "api",
    ...overrides,
  };
}

function makeSummary(states: Partial<Record<ConnectorHealthState, number>>): ConnectorHealthSummary {
  return {
    total: Object.values(states).reduce((a, b) => a + (b ?? 0), 0),
    states: {
      healthy: states.healthy ?? 0,
      degraded: states.degraded ?? 0,
      rate_limited: states.rate_limited ?? 0,
      auth_failed: states.auth_failed ?? 0,
      provider_error: states.provider_error ?? 0,
      disabled: states.disabled ?? 0,
    },
    lastUpdatedAt: "2026-05-20T03:01:00.000Z",
    alertPolicy: {
      degradedWithinMinutes: 15,
      authFailureThreshold15m: 3,
      rateLimitThreshold15m: 5,
      outageThresholdMinutes: 30,
    },
    source: "api",
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/integrations/health"]}>
      <ConnectorHealth />
    </MemoryRouter>,
  );
}

describe("ConnectorHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getAccessTokenMock.mockResolvedValue("token-123");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the page chrome (eyebrow / h1 / refresh) and a healthy summary", async () => {
    getConnectorHealthMock.mockResolvedValueOnce({
      connectors: [makeRecord({})],
      summary: makeSummary({ healthy: 1 }),
    });

    renderPage();

    expect(await screen.findByText("Connector health")).toBeInTheDocument();
    expect(screen.getByText(/Connect · Integrations/i)).toBeInTheDocument();
    // "all healthy" copy when no states need attention.
    expect(screen.getByText(/all healthy/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh/i })).toBeInTheDocument();
  });

  it("renders a Reconnect CTA only for auth_failed rows (HEL-179)", async () => {
    getConnectorHealthMock.mockResolvedValueOnce({
      connectors: [
        makeRecord({
          connectorKey: "slack",
          connectorName: "Slack",
          state: "auth_failed",
          lastErrorMessage: "Token revoked by Slack",
          authFailures15m: 4,
          successRate24h: 60,
        }),
        makeRecord({
          connectorKey: "hubspot",
          connectorName: "HubSpot",
          state: "healthy",
        }),
      ],
      summary: makeSummary({ auth_failed: 1, healthy: 1 }),
    });

    renderPage();

    const reconnect = await screen.findByRole("link", { name: /reconnect/i });
    // Targets the Slack row specifically.
    expect(reconnect).toHaveAttribute("href", "/integrations/mcp?reconnect=slack");
    // Healthy HubSpot row should NOT have a Reconnect CTA.
    expect(screen.getAllByRole("link", { name: /reconnect/i })).toHaveLength(1);
    // Auth-failure copy surfaces.
    expect(screen.getByText("Token revoked by Slack")).toBeInTheDocument();
  });

  it("sorts auth_failed rows above healthy rows", async () => {
    getConnectorHealthMock.mockResolvedValueOnce({
      connectors: [
        makeRecord({ connectorKey: "hubspot", connectorName: "HubSpot", state: "healthy" }),
        makeRecord({
          connectorKey: "slack",
          connectorName: "Slack",
          state: "auth_failed",
          lastErrorMessage: "Revoked",
        }),
        makeRecord({ connectorKey: "linear", connectorName: "Linear", state: "degraded" }),
      ],
      summary: makeSummary({ auth_failed: 1, degraded: 1, healthy: 1 }),
    });

    renderPage();

    await screen.findByText("Connector health");
    const names = screen.getAllByText(/Slack|HubSpot|Linear/, { selector: "strong" });
    // auth_failed (Slack) → degraded (Linear) → healthy (HubSpot)
    expect(names[0]).toHaveTextContent("Slack");
    expect(names[1]).toHaveTextContent("Linear");
    expect(names[2]).toHaveTextContent("HubSpot");
  });

  it("surfaces a recoverable error on the initial load via the retry CTA", async () => {
    getConnectorHealthMock.mockRejectedValueOnce(new Error("backend offline"));
    renderPage();

    expect(await screen.findByText(/backend offline/i)).toBeInTheDocument();
    // ErrorState exposes a "Retry" button.
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("manual refresh re-fetches the health payload (HEL-179)", async () => {
    getConnectorHealthMock
      .mockResolvedValueOnce({
        connectors: [makeRecord({ state: "healthy" })],
        summary: makeSummary({ healthy: 1 }),
      })
      .mockResolvedValueOnce({
        connectors: [
          makeRecord({
            state: "auth_failed",
            lastErrorMessage: "Token revoked",
          }),
        ],
        summary: makeSummary({ auth_failed: 1 }),
      });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    renderPage();

    await screen.findByText("Connector health");
    expect(screen.queryByText("Token revoked")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() => {
      expect(screen.getByText("Token revoked")).toBeInTheDocument();
    });
    expect(getConnectorHealthMock).toHaveBeenCalledTimes(2);
  });
});
