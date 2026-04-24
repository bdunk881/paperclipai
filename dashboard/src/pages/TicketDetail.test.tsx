import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  user: { id: "user-1", email: "user@example.com", name: "User One" } as null | {
    id: string;
    email: string;
    name: string;
  },
  getAccessToken: vi.fn().mockResolvedValue("token-123"),
}));

const ticketsApiMocks = vi.hoisted(() => ({
  getTicket: vi.fn(),
  addTicketUpdate: vi.fn(),
  transitionTicket: vi.fn(),
  searchTicketMemories: vi.fn(),
}));

const agentApiMocks = vi.hoisted(() => ({
  listAgents: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => authState,
}));

vi.mock("../api/agentApi", () => ({
  listAgents: agentApiMocks.listAgents,
}));

vi.mock("../api/tickets", async () => {
  const actual = await vi.importActual<typeof import("../api/tickets")>("../api/tickets");
  return {
    ...actual,
    getTicket: ticketsApiMocks.getTicket,
    addTicketUpdate: ticketsApiMocks.addTicketUpdate,
    transitionTicket: ticketsApiMocks.transitionTicket,
    searchTicketMemories: ticketsApiMocks.searchTicketMemories,
  };
});

import TicketDetail from "./TicketDetail";

const baseAggregate = {
  ticket: {
    id: "ticket-1",
    workspaceId: "workspace-1",
    title: "Collaboration detail pass",
    description: "Bring mentions, close flow, and memory into ticket detail.",
    creatorId: "alex.pm",
    status: "in_progress",
    priority: "high",
    slaState: "warning",
    tags: ["ticketing", "collaboration"],
    assignees: [
      { type: "user", id: "user-1", role: "primary" },
      { type: "user", id: "user-2", role: "collaborator" },
    ],
    createdAt: "2026-04-24T00:00:00.000Z",
    updatedAt: "2026-04-24T01:00:00.000Z",
  },
  updates: [
    {
      id: "update-1",
      ticketId: "ticket-1",
      actor: { type: "user", id: "user-2" },
      type: "comment",
      content: "Ready for collaboration wiring.",
      metadata: {},
      createdAt: "2026-04-24T00:15:00.000Z",
    },
  ],
  childTickets: [
    {
      id: "ticket-child-1",
      title: "Wire mention metadata",
      status: "blocked",
      owner: { type: "agent", id: "frontend-engineer" },
      updatedAt: "2026-04-24T00:45:00.000Z",
    },
  ],
  closeRequest: null,
};

function renderTicketDetail() {
  return render(
    <MemoryRouter initialEntries={["/tickets/ticket-1"]}>
      <Routes>
        <Route path="/tickets/:ticketId" element={<TicketDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("TicketDetail", () => {
  beforeEach(() => {
    authState.user = { id: "user-1", email: "user@example.com", name: "User One" };
    authState.getAccessToken.mockResolvedValue("token-123");
    ticketsApiMocks.getTicket.mockResolvedValue(structuredClone(baseAggregate));
    ticketsApiMocks.addTicketUpdate.mockResolvedValue({
      update: {
        id: "update-new",
        ticketId: "ticket-1",
        actor: { type: "user", id: "user-1" },
        type: "structured_update",
        content: "Created from test.",
        metadata: {},
        createdAt: "2026-04-24T02:00:00.000Z",
      },
      source: "api",
    });
    ticketsApiMocks.transitionTicket.mockResolvedValue({
      ...structuredClone(baseAggregate),
      ticket: {
        ...structuredClone(baseAggregate).ticket,
        status: "resolved",
        resolvedAt: "2026-04-24T02:00:00.000Z",
      },
      source: "api",
    });
    ticketsApiMocks.searchTicketMemories.mockResolvedValue({
      results: [
        {
          id: "mem-1",
          key: "close-flow",
          text: "Primary-gated confirmation protects tickets from accidental resolution.",
          agentId: "frontend-engineer",
          updatedAt: "2026-04-24T00:40:00.000Z",
        },
      ],
      total: 1,
      source: "api",
    });
    agentApiMocks.listAgents.mockResolvedValue([
      {
        id: "frontend-engineer",
        userId: "agent-user-1",
        name: "Frontend Engineer",
        description: "Builds dashboard UI",
        roleKey: "engineer",
        model: "gpt-5.4",
        instructions: "",
        status: "running",
        budgetMonthlyUsd: 0,
        metadata: {},
        createdAt: "2026-04-24T00:00:00.000Z",
        updatedAt: "2026-04-24T00:00:00.000Z",
      },
    ]);
  });

  it("renders the memory sidebar and linked child tickets", async () => {
    renderTicketDetail();

    expect(await screen.findByText("Memory")).toBeInTheDocument();
    expect(screen.getByText("Wire mention metadata")).toBeInTheDocument();
    expect(
      screen.getByText("Primary-gated confirmation protects tickets from accidental resolution.")
    ).toBeInTheDocument();
  });

  it("inserts a mention from autocomplete into the composer", async () => {
    const user = userEvent.setup();
    renderTicketDetail();

    const composer = await screen.findByPlaceholderText(
      /summarize progress, blockers, or handoff notes/i
    );
    await user.type(composer, "@fr");

    const mentionOption = (await screen.findAllByText("Frontend Engineer")).find((entry) =>
      entry.closest("button")
    );
    expect(mentionOption).toBeDefined();
    await user.click(mentionOption!.closest("button")!);

    await waitFor(() => {
      expect(composer).toHaveValue("@Frontend Engineer ");
    });
  });

  it("lets a collaborator propose close through a structured update", async () => {
    authState.user = { id: "user-2", email: "collab@example.com", name: "User Two" };
    const user = userEvent.setup();
    renderTicketDetail();

    const button = await screen.findByRole("button", { name: /propose close/i });
    await user.click(button);

    await waitFor(() => {
      expect(ticketsApiMocks.addTicketUpdate).toHaveBeenCalledWith(
        "ticket-1",
        expect.objectContaining({
          metadata: expect.objectContaining({
            closeRequest: expect.objectContaining({
              status: "pending",
              requestedBy: { type: "user", id: "user-2" },
            }),
          }),
        }),
        "token-123"
      );
    });
  });

  it("allows the primary assignee to confirm close with a double click", async () => {
    ticketsApiMocks.getTicket.mockResolvedValue({
      ...structuredClone(baseAggregate),
      closeRequest: {
        id: "close-request-1",
        status: "pending",
        requestedBy: { type: "user", id: "user-2" },
        requestedAt: "2026-04-24T01:30:00.000Z",
        note: "Ready to close.",
      },
    });
    const user = userEvent.setup();
    renderTicketDetail();

    const button = await screen.findByRole("button", { name: /confirm close/i });
    await user.dblClick(button);

    await waitFor(() => {
      expect(ticketsApiMocks.transitionTicket).toHaveBeenCalledWith(
        "ticket-1",
        expect.objectContaining({ status: "resolved" }),
        "token-123"
      );
    });
  });
});
