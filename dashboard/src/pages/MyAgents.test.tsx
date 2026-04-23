import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import MyAgents from "./MyAgents";

const { getAccessTokenMock, getControlPlaneSnapshotMock } = vi.hoisted(() => ({
  getAccessTokenMock: vi.fn(),
  getControlPlaneSnapshotMock: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "user@example.com", name: "User" },
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
    getAccessToken: getAccessTokenMock,
  }),
}));

vi.mock("../api/controlPlane", () => ({
  getControlPlaneSnapshot: getControlPlaneSnapshotMock,
}));

describe("MyAgents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccessTokenMock.mockResolvedValue("token-123");
    getControlPlaneSnapshotMock.mockResolvedValue([
      {
        team: {
          id: "team-1",
          name: "Revenue Control Plane",
          deploymentMode: "continuous_agents",
          budgetMonthlyUsd: 500,
          orchestrationEnabled: true,
          createdAt: "2026-04-23T00:00:00.000Z",
          updatedAt: "2026-04-23T00:00:00.000Z",
        },
        agents: [
          {
            id: "agent-1",
            teamId: "team-1",
            name: "Outbound SDR",
            roleKey: "sales-operator",
            instructions: "Handle outbound queue",
            budgetMonthlyUsd: 120,
            schedule: { type: "interval", intervalMinutes: 60 },
            status: "active",
            createdAt: "2026-04-23T00:00:00.000Z",
            updatedAt: "2026-04-23T00:00:00.000Z",
          },
        ],
        tasks: [],
        heartbeats: [
          {
            id: "heartbeat-1",
            teamId: "team-1",
            agentId: "agent-1",
            status: "completed",
            summary: "Processed outbound queue",
            costUsd: 8.5,
            createdTaskIds: [],
            startedAt: "2026-04-23T02:00:00.000Z",
            completedAt: "2026-04-23T02:05:00.000Z",
          },
        ],
      },
    ]);
  });

  it("renders live control-plane agent data", async () => {
    render(
      <MemoryRouter>
        <MyAgents />
      </MemoryRouter>
    );

    expect(await screen.findByText("Outbound SDR")).toBeInTheDocument();
    expect(screen.getByText("Revenue Control Plane")).toBeInTheDocument();
    expect(screen.getAllByText("$8.50")).toHaveLength(2);
    expect(getControlPlaneSnapshotMock).toHaveBeenCalledWith("token-123");
  });
});
