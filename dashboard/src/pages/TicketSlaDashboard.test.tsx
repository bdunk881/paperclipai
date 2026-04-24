import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  getAccessToken: vi.fn().mockResolvedValue("token-123"),
}));

const ticketingSlaApi = vi.hoisted(() => ({
  getTicketSlaDashboard: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => authState,
}));

vi.mock("../api/ticketingSla", () => ({
  getTicketSlaDashboard: ticketingSlaApi.getTicketSlaDashboard,
}));

import TicketSlaDashboard from "./TicketSlaDashboard";

describe("TicketSlaDashboard", () => {
  beforeEach(() => {
    ticketingSlaApi.getTicketSlaDashboard.mockResolvedValue({
      summaryCards: [
        { key: "breach_rate", label: "Breach Rate", value: "8.4%", delta: "-1.2%", trend: "improving" },
        { key: "avg_first_response", label: "Avg Time to First Response", value: "42m", delta: "-6m", trend: "improving" },
        { key: "active_breaches", label: "Active Breaches", value: "3", delta: "+1", trend: "worsening" },
      ],
      resolutionBuckets: [{ label: "<1h", count: 10, percent: 25 }],
      actorBreakdown: [
        {
          actor: { type: "agent", id: "frontend-engineer" },
          activeCount: 9,
          atRiskCount: 2,
          breachedCount: 1,
          avgResolutionHours: 7.4,
        },
      ],
      priorityBreakdown: [
        {
          priority: "high",
          activeCount: 13,
          atRiskCount: 2,
          breachRate: 9,
          avgFirstResponseMinutes: 38,
        },
      ],
    });
  });

  it("renders dashboard summary cards and drill links", async () => {
    render(
      <MemoryRouter>
        <TicketSlaDashboard />
      </MemoryRouter>
    );

    expect(await screen.findByText("Ticketing SLA Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Breach Rate")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /SLA settings/i })).toHaveAttribute(
      "href",
      "/settings/ticketing-sla"
    );
    expect(screen.getByRole("link", { name: /Frontend Engineer/i })).toHaveAttribute(
      "href",
      "/tickets/actors/agent/frontend-engineer"
    );
  });
});
