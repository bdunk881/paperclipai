import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  getAccessToken: vi.fn().mockResolvedValue("token-123"),
}));

const connectorHealthApi = vi.hoisted(() => ({
  getConnectorHealth: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => authState,
}));

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    getConnectorHealth: connectorHealthApi.getConnectorHealth,
  };
});

import ConnectorHealth from "./ConnectorHealth";

describe("ConnectorHealth", () => {
  beforeEach(() => {
    connectorHealthApi.getConnectorHealth.mockResolvedValue({
      connectors: [],
      summary: {
        total: 0,
        states: {
          healthy: 0,
          degraded: 0,
          rate_limited: 0,
          auth_failure: 0,
          down: 0,
        },
        lastUpdatedAt: "2026-05-01T00:00:00.000Z",
        alertPolicy: {
          degradedWithinMinutes: 5,
          authFailureThreshold15m: 5,
          rateLimitThreshold15m: 5,
          outageThresholdMinutes: 15,
        },
        source: "api",
      },
    });
  });

  it("loads connector health with the current access token", async () => {
    render(
      <MemoryRouter>
        <ConnectorHealth />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(connectorHealthApi.getConnectorHealth).toHaveBeenCalledWith("token-123");
    });
  });
});
