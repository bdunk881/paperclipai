import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
});
