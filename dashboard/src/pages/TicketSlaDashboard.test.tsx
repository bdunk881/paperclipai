import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  getAccessToken: vi.fn().mockResolvedValue("token-123"),
}));

const workspaceState = vi.hoisted(() => ({
  activeWorkspaceId: null as string | null,
}));

const ticketingSlaApi = vi.hoisted(() => ({
  getTicketSlaDashboard: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => authState,
}));

vi.mock("../context/useWorkspace", () => ({
  useWorkspace: () => workspaceState,
}));

vi.mock("../api/ticketingSla", () => ({
  getTicketSlaDashboard: ticketingSlaApi.getTicketSlaDashboard,
}));

import TicketSlaDashboard from "./TicketSlaDashboard";

describe("TicketSlaDashboard (V2 / DASH-18)", () => {
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

  it("renders V2 chrome (af2-page, eyebrow, serif h1)", async () => {
    const { container } = render(
      <MemoryRouter>
        <TicketSlaDashboard />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /mission assignment sla dashboard/i,
      }),
    ).toBeInTheDocument();
    expect(container.querySelector(".af2-page")).not.toBeNull();
    expect(container.querySelector(".af2-page-head")).not.toBeNull();
    expect(screen.getByText(/run · assignments · sla/i)).toBeInTheDocument();
  });

  it("renders summary stats, sub-page links, and per-actor drill", async () => {
    render(
      <MemoryRouter>
        <TicketSlaDashboard />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Breach Rate")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to queue/i })).toHaveAttribute(
      "href",
      "/mission-assignments",
    );
    expect(screen.getByRole("link", { name: /sla settings/i })).toHaveAttribute(
      "href",
      "/settings/ticketing-sla",
    );
    // Per-actor drill now points at the V2 mission-assignments actor view.
    expect(
      screen.getByRole("link", { name: /frontend engineer/i }),
    ).toHaveAttribute(
      "href",
      "/mission-assignments/actors/agent/frontend-engineer",
    );
  });
});
