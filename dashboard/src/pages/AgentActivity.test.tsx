import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgentActivity from "./AgentActivity";

const listAgentActivityMock = vi.fn();

vi.mock("../data/agentMarketplaceData", () => ({
  listAgentActivity: () => listAgentActivityMock(),
}));

describe("AgentActivity", () => {
  beforeEach(() => {
    listAgentActivityMock.mockReset();
  });

  it("filters activity by search query and status", () => {
    listAgentActivityMock.mockReturnValue([
      {
        id: "1",
        agentName: "Sales Agent",
        action: "Agent resumed",
        status: "info",
        tokenUsage: 128,
        summary: "Sales Agent resumed successfully.",
        createdAt: "2026-04-22T00:00:00.000Z",
      },
      {
        id: "2",
        agentName: "Support Agent",
        action: "Agent warning",
        status: "warning",
        tokenUsage: 64,
        summary: "Support Agent exceeded retry budget.",
        createdAt: "2026-04-22T01:00:00.000Z",
      },
    ]);

    render(
      <MemoryRouter>
        <AgentActivity />
      </MemoryRouter>
    );

    expect(screen.getByText("Agent resumed")).toBeInTheDocument();
    expect(screen.getByText("Agent warning")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/filter activity/i), {
      target: { value: "support" },
    });

    expect(screen.queryByText("Agent resumed")).not.toBeInTheDocument();
    expect(screen.getByText("Agent warning")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "warning" }));

    expect(screen.getByText("Agent warning")).toBeInTheDocument();
    expect(screen.queryByText("Agent resumed")).not.toBeInTheDocument();
  });

  it("shows an empty-state message when no events match the filter", () => {
    listAgentActivityMock.mockReturnValue([
      {
        id: "1",
        agentName: "Sales Agent",
        action: "Agent resumed",
        status: "info",
        tokenUsage: 128,
        summary: "Sales Agent resumed successfully.",
        createdAt: "2026-04-22T00:00:00.000Z",
      },
    ]);

    render(
      <MemoryRouter>
        <AgentActivity />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByPlaceholderText(/filter activity/i), {
      target: { value: "no-match" },
    });

    expect(screen.getByText(/no activity events match this filter/i)).toBeInTheDocument();
  });
});
