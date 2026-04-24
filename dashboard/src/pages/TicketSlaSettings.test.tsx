import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  getAccessToken: vi.fn().mockResolvedValue("token-123"),
}));

const ticketingSlaApi = vi.hoisted(() => ({
  getTicketSlaSettings: vi.fn(),
  updateTicketSlaSettings: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => authState,
}));

vi.mock("../api/ticketingSla", () => ({
  getTicketSlaSettings: ticketingSlaApi.getTicketSlaSettings,
  updateTicketSlaSettings: ticketingSlaApi.updateTicketSlaSettings,
}));

import TicketSlaSettings from "./TicketSlaSettings";

const settingsFixture = {
  policies: [
    { priority: "urgent", firstResponseMinutes: 15, resolutionMinutes: 240 },
    { priority: "high", firstResponseMinutes: 60, resolutionMinutes: 480 },
    { priority: "medium", firstResponseMinutes: 240, resolutionMinutes: 1440 },
    { priority: "low", firstResponseMinutes: 480, resolutionMinutes: 4320 },
  ],
  escalationRules: [
    {
      priority: "urgent",
      notifyTargets: ["@CTO"],
      autoBumpPriority: false,
      autoReassign: true,
      fallbackActor: { type: "agent", id: "cto" },
    },
    {
      priority: "high",
      notifyTargets: ["@Frontend Engineer"],
      autoBumpPriority: true,
      autoReassign: false,
    },
    {
      priority: "medium",
      notifyTargets: ["support@autoflow.ai"],
      autoBumpPriority: false,
      autoReassign: false,
    },
    {
      priority: "low",
      notifyTargets: ["ops@autoflow.ai"],
      autoBumpPriority: false,
      autoReassign: false,
    },
  ],
  fallbackCandidates: [
    { type: "agent", id: "frontend-engineer" },
    { type: "agent", id: "cto" },
  ],
  updatedAt: "2026-04-24T02:10:00.000Z",
};

describe("TicketSlaSettings", () => {
  beforeEach(() => {
    ticketingSlaApi.getTicketSlaSettings.mockResolvedValue(structuredClone(settingsFixture));
    ticketingSlaApi.updateTicketSlaSettings.mockResolvedValue(structuredClone(settingsFixture));
  });

  it("renders the policy editor and escalation builder", async () => {
    render(
      <MemoryRouter>
        <TicketSlaSettings />
      </MemoryRouter>
    );

    expect(await screen.findByText("SLA Policy Editor")).toBeInTheDocument();
    expect(screen.getByText("Targets by priority")).toBeInTheDocument();
    expect(screen.getByText("Breach rules")).toBeInTheDocument();
  });

  it("blocks save when auto-reassign is enabled without a fallback actor", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TicketSlaSettings />
      </MemoryRouter>
    );

    await screen.findByText("SLA Policy Editor");
    const fallbackSelect = screen.getAllByLabelText(/fallback actor/i)[0];
    await user.selectOptions(fallbackSelect, "");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText(/fallback actor is required/i)).toBeInTheDocument();
    expect(ticketingSlaApi.updateTicketSlaSettings).not.toHaveBeenCalled();
  });

  it("saves valid SLA settings", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TicketSlaSettings />
      </MemoryRouter>
    );

    await screen.findByText("SLA Policy Editor");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(ticketingSlaApi.updateTicketSlaSettings).toHaveBeenCalled();
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });
});
