import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import RunHistory from "./RunHistory";

const {
  listRunsMock,
  listTemplatesMock,
  getAccessTokenMock,
} = vi.hoisted(() => ({
  listRunsMock: vi.fn(),
  listTemplatesMock: vi.fn(),
  getAccessTokenMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  listRuns: listRunsMock,
  listTemplates: listTemplatesMock,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "user@example.com", name: "Test User" },
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
    getAccessToken: getAccessTokenMock,
  }),
}));

describe("RunHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccessTokenMock.mockResolvedValue("mock-token");
    listTemplatesMock.mockResolvedValue([]);
    listRunsMock.mockResolvedValue([
      {
        id: "run_123",
        templateId: "tpl-1",
        templateName: "Daily Ops Audit",
        status: "running",
        startedAt: "2026-04-19T18:00:00.000Z",
        input: { audience: "ops" },
        output: {},
        stepResults: [
          {
            stepId: "trigger-start",
            stepName: "Receive trigger",
            status: "success",
            durationMs: 120,
            output: { message: "Webhook payload accepted." },
          },
          {
            stepId: "agent-review",
            stepName: "Review campaign data",
            status: "running",
            durationMs: 820,
            output: { reasoning: "Assessing anomalies and preparing remediation notes." },
          },
        ],
      },
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the run audit sidebar from a history row", async () => {
    render(
      <MemoryRouter>
        <RunHistory />
      </MemoryRouter>
    );

    expect(await screen.findByText("Daily Ops Audit")).toBeInTheDocument();
    expect(listRunsMock).toHaveBeenCalledWith(undefined, "mock-token");

    fireEvent.click(screen.getByRole("button", { name: /open run audit for daily ops audit/i }));

    expect(screen.getByRole("dialog", { name: /run audit view/i })).toBeInTheDocument();
    expect(screen.getByText(/assessing anomalies and preparing remediation notes/i)).toBeInTheDocument();
  });
});
