import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgentActivity from "./AgentActivity";

const { getAccessTokenMock, listAgentsMock, getAgentHeartbeatMock, listAgentRunsMock } = vi.hoisted(() => ({
  getAccessTokenMock: vi.fn(),
  listAgentsMock: vi.fn(),
  getAgentHeartbeatMock: vi.fn(),
  listAgentRunsMock: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    getAccessToken: getAccessTokenMock,
  }),
}));

vi.mock("../api/agentApi", () => ({
  listAgents: listAgentsMock,
  getAgentHeartbeat: getAgentHeartbeatMock,
  listAgentRuns: listAgentRunsMock,
}));

describe("AgentActivity", () => {
  beforeEach(() => {
    getAccessTokenMock.mockReset();
    listAgentsMock.mockReset();
    getAgentHeartbeatMock.mockReset();
    listAgentRunsMock.mockReset();

    getAccessTokenMock.mockResolvedValue("token-123");
  });

  it("filters activity by search query and status", async () => {
    listAgentsMock.mockResolvedValue([
      {
        id: "agent-sales",
        name: "Sales Agent",
      },
      {
        id: "agent-support",
        name: "Support Agent",
      },
    ]);
    getAgentHeartbeatMock.mockImplementation(async (agentId: string) => {
      if (agentId === "agent-sales") {
        return {
          id: "heartbeat-sales",
          status: "paused",
          summary: "Sales Agent resumed successfully.",
          tokenUsage: 128,
          recordedAt: "2026-04-22T00:00:00.000Z",
        };
      }
      if (agentId === "agent-support") {
        return {
          id: "heartbeat-support",
          status: "error",
          summary: "Support Agent exceeded retry budget.",
          tokenUsage: 64,
          recordedAt: "2026-04-22T01:00:00.000Z",
        };
      }
      return null;
    });
    listAgentRunsMock.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <AgentActivity />
      </MemoryRouter>
    );

    expect(await screen.findByText("Heartbeat paused")).toBeInTheDocument();
    expect(screen.getByText("Heartbeat error")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/filter activity/i), {
      target: { value: "support" },
    });

    expect(screen.queryByText("Heartbeat paused")).not.toBeInTheDocument();
    expect(screen.getByText("Heartbeat error")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "warning" }));

    expect(screen.getByText("Heartbeat error")).toBeInTheDocument();
    expect(screen.queryByText("Heartbeat paused")).not.toBeInTheDocument();
  });

  it("shows an empty-state message when no events match the filter", async () => {
    listAgentsMock.mockResolvedValue([
      {
        id: "agent-sales",
        name: "Sales Agent",
      },
    ]);
    getAgentHeartbeatMock.mockResolvedValue({
      id: "heartbeat-sales",
      status: "paused",
      summary: "Sales Agent resumed successfully.",
      tokenUsage: 128,
      recordedAt: "2026-04-22T00:00:00.000Z",
    });
    listAgentRunsMock.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <AgentActivity />
      </MemoryRouter>
    );

    expect(await screen.findByText("Heartbeat paused")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/filter activity/i), {
      target: { value: "no-match" },
    });

    expect(screen.getByText(/no activity matches this filter/i)).toBeInTheDocument();
  });
});
