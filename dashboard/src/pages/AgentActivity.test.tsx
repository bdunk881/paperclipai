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
const accessModeMock = vi.fn();

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    accessMode: accessModeMock(),
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
    accessModeMock.mockReset();

    accessModeMock.mockReturnValue("authenticated");
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

    // After HEL-60 v2 restyle, status filter buttons render as tabs labeled
    // "All / Live / Blocked / Other" (mapping success / warning / info to
    // operator-meaningful names). "Blocked" maps to the warning status.
    fireEvent.click(screen.getByRole("button", { name: "Blocked" }));

    expect(screen.getByText("Heartbeat error")).toBeInTheDocument();
    expect(screen.queryByText("Heartbeat paused")).not.toBeInTheDocument();
  });

  it("renders with v2 structural markers (HEL-60)", async () => {
    // Regression guard: assert v2 chrome is actually present, not just af2-*
    // color tokens. Mirrors the marker check from Settings.test.tsx (HEL-64).
    listAgentsMock.mockResolvedValue([
      {
        id: "agent-sales",
        name: "Sales Agent",
      },
    ]);
    getAgentHeartbeatMock.mockResolvedValue({
      id: "heartbeat-sales",
      status: "running",
      summary: "Sales Agent is online.",
      tokenUsage: 42,
      recordedAt: "2026-04-22T00:00:00.000Z",
    });
    listAgentRunsMock.mockResolvedValue([]);

    const { container } = render(
      <MemoryRouter>
        <AgentActivity />
      </MemoryRouter>
    );

    expect(await screen.findByText("Heartbeat running")).toBeInTheDocument();
    expect(container.querySelector(".af2-page")).not.toBeNull();
    expect(container.querySelector(".af2-page-head")).not.toBeNull();
    expect(container.querySelector(".af2-eyebrow")).not.toBeNull();
    expect(container.querySelector("h1.af2-h1")).not.toBeNull();
    expect(container.querySelector(".af2-tabs")).not.toBeNull();
    expect(container.querySelector(".af2-card")).not.toBeNull();
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

  it("renders the preview empty state without calling protected agent APIs", async () => {
    accessModeMock.mockReturnValue("preview");
    getAccessTokenMock.mockResolvedValue(null);

    render(
      <MemoryRouter>
        <AgentActivity />
      </MemoryRouter>
    );

    expect(await screen.findByText(/no activity yet/i)).toBeInTheDocument();
    expect(listAgentsMock).not.toHaveBeenCalled();
  });
});
