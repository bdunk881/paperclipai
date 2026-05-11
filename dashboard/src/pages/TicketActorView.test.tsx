import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TicketRecord } from "../api/tickets";

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

  it("shows 'Actor not found' when no actorType/actorId params are provided", () => {
    render(
      <MemoryRouter initialEntries={["/tickets/actors"]}>
        <Routes>
          <Route path="/tickets/actors" element={<TicketActorView />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText(/actor not found/i)).toBeInTheDocument();
  });

  it("shows skeleton loading state while fetching", () => {
    ticketsApiMocks.listTicketQueue.mockReturnValueOnce(new Promise(() => {}));
    const { container } = render(
      <MemoryRouter initialEntries={["/tickets/actors/user/user-1"]}>
        <Routes>
          <Route path="/tickets/actors/:actorType/:actorId" element={<TicketActorView />} />
        </Routes>
      </MemoryRouter>
    );
    expect(container.querySelector(".scanline-skeleton")).not.toBeNull();
  });

  it("shows fallback error message for non-Error throw", async () => {
    ticketsApiMocks.listTicketQueue.mockRejectedValueOnce("string error");
    render(
      <MemoryRouter initialEntries={["/tickets/actors/user/user-1"]}>
        <Routes>
          <Route path="/tickets/actors/:actorType/:actorId" element={<TicketActorView />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText(/failed to load actor queue/i)).toBeInTheDocument());
  });

  it("renders tickets after successful load", async () => {
    const ticket: TicketRecord = {
      id: "t1",
      workspaceId: "ws-1",
      title: "Fix login bug",
      description: "",
      creatorId: "u1",
      status: "open",
      priority: "high",
      slaState: "ok",
      tags: [],
      assignees: [{ type: "user", id: "user-1", role: "primary" }],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    ticketsApiMocks.listTicketQueue.mockResolvedValueOnce({ tickets: [ticket], total: 1, source: "api" });
    render(
      <MemoryRouter initialEntries={["/tickets/actors/user/user-1"]}>
        <Routes>
          <Route path="/tickets/actors/:actorType/:actorId" element={<TicketActorView />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Fix login bug")).toBeInTheDocument());
  });
});
