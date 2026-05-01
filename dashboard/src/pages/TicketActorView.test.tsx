import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  getAccessToken: vi.fn().mockResolvedValue("token-123"),
}));

const ticketsApiMocks = vi.hoisted(() => ({
  listTicketQueue: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => authState,
}));

vi.mock("../api/tickets", async () => {
  const actual = await vi.importActual<typeof import("../api/tickets")>("../api/tickets");
  return {
    ...actual,
    listTicketQueue: ticketsApiMocks.listTicketQueue,
  };
});

import TicketActorView from "./TicketActorView";

describe("TicketActorView", () => {
  beforeEach(() => {
    authState.getAccessToken.mockResolvedValue("token-123");
    ticketsApiMocks.listTicketQueue.mockRejectedValue(new Error("actor queue unavailable"));
  });

  it("does not render the fallback notice when the live actor queue fails", async () => {
    render(
      <MemoryRouter initialEntries={["/tickets/actors/user/user-1"]}>
        <Routes>
          <Route path="/tickets/actors/:actorType/:actorId" element={<TicketActorView />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("actor queue unavailable")).toBeInTheDocument();
    expect(
      screen.queryByText(/showing local ticketing fallback data while the backend branch is still in review/i)
    ).not.toBeInTheDocument();
  });
});
