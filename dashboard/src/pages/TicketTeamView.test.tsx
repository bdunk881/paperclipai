import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TicketRecord } from "../api/tickets";

const authState = vi.hoisted(() => ({
  getAccessToken: vi.fn().mockResolvedValue("token-123"),
}));

const ticketsApiMocks = vi.hoisted(() => ({
  listTickets: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => authState,
}));

vi.mock("../api/tickets", async () => {
  const actual = await vi.importActual<typeof import("../api/tickets")>("../api/tickets");
  return {
    ...actual,
    listTickets: ticketsApiMocks.listTickets,
  };
});

import TicketTeamView from "./TicketTeamView";

describe("TicketTeamView", () => {
  beforeEach(() => {
    authState.getAccessToken.mockResolvedValue("token-123");
    ticketsApiMocks.listTickets.mockRejectedValue(new Error("team view unavailable"));
  });

  it("does not render the fallback notice when the live team view fails", async () => {
    render(
      <MemoryRouter>
        <TicketTeamView />
      </MemoryRouter>
    );

    expect(await screen.findByText("team view unavailable")).toBeInTheDocument();
    expect(
      screen.queryByText(/showing local ticketing fallback data while the backend branch is still in review/i)
    ).not.toBeInTheDocument();
  });

  it("shows skeleton loading state while fetching", () => {
    ticketsApiMocks.listTickets.mockReturnValueOnce(new Promise(() => {}));
    const { container } = render(<MemoryRouter><TicketTeamView /></MemoryRouter>);
    expect(container.querySelector(".scanline-skeleton")).not.toBeNull();
  });

  it("shows fallback error message for non-Error throw", async () => {
    ticketsApiMocks.listTickets.mockRejectedValueOnce("string error");
    render(<MemoryRouter><TicketTeamView /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/failed to load team view/i)).toBeInTheDocument());
  });

  it("renders agent and human columns after successful load", async () => {
    const agentTicket: TicketRecord = {
      id: "t1",
      workspaceId: "ws-1",
      title: "Agent task",
      description: "",
      creatorId: "u1",
      status: "open",
      priority: "medium",
      slaState: "ok",
      tags: [],
      assignees: [{ type: "agent", id: "agent-1", role: "primary" }],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const humanTicket: TicketRecord = {
      ...agentTicket,
      id: "t2",
      title: "Human task",
      assignees: [{ type: "user", id: "user-1", role: "primary" }],
    };
    ticketsApiMocks.listTickets.mockResolvedValueOnce({ tickets: [agentTicket, humanTicket], total: 2, source: "api" });
    render(<MemoryRouter><TicketTeamView /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getAllByText(/agents/i).length).toBeGreaterThan(0);
    });
  });
});
