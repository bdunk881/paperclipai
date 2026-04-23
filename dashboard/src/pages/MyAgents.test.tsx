import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MyAgents from "./MyAgents";

const listDeploymentsMock = vi.fn();
const saveDeploymentsMock = vi.fn();
const appendAgentActivityMock = vi.fn();

vi.mock("../data/agentMarketplaceData", () => ({
  listDeployments: () => listDeploymentsMock(),
  saveDeployments: (next: unknown) => saveDeploymentsMock(next),
  appendAgentActivity: (entry: unknown) => appendAgentActivityMock(entry),
}));

describe("MyAgents", () => {
  beforeEach(() => {
    listDeploymentsMock.mockReset();
    saveDeploymentsMock.mockReset();
    appendAgentActivityMock.mockReset();
  });

  it("renders the deployed agent summary and toggles pause state", () => {
    listDeploymentsMock.mockReturnValue([
      {
        id: "agent-1",
        name: "Sales Agent",
        templateName: "Sales Template",
        status: "running",
        deployedAt: "2026-04-22T00:00:00.000Z",
        lastActiveAt: "2026-04-22T01:00:00.000Z",
        tokenUsage24h: 1234,
        integrations: ["HubSpot", "Slack"],
      },
    ]);

    render(
      <MemoryRouter>
        <MyAgents />
      </MemoryRouter>
    );

    expect(screen.getByText("My Agents")).toBeInTheDocument();
    expect(screen.getByText("Sales Agent")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view logs/i })).toHaveAttribute(
      "href",
      "/logs"
    );

    fireEvent.click(screen.getByRole("button", { name: /pause/i }));

    expect(saveDeploymentsMock).toHaveBeenCalledTimes(1);
    expect(appendAgentActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: "Sales Agent",
        action: "Agent paused",
        status: "info",
      })
    );
  });

  it("shows the empty state when there are no deployed agents", () => {
    listDeploymentsMock.mockReturnValue([]);

    render(
      <MemoryRouter>
        <MyAgents />
      </MemoryRouter>
    );

    expect(screen.getByText(/no deployed agents yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open marketplace/i })).toHaveAttribute(
      "href",
      "/agents"
    );
  });
});
