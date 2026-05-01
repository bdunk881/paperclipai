import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import RunHistory from "./RunHistory";

const {
  listRunsMock,
  listTemplatesMock,
  getAccessTokenMock,
  requireAccessTokenMock,
} = vi.hoisted(() => ({
  listRunsMock: vi.fn(),
  listTemplatesMock: vi.fn(),
  getAccessTokenMock: vi.fn(),
  requireAccessTokenMock: vi.fn(),
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
    requireAccessToken: requireAccessTokenMock,
  }),
}));

describe("RunHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccessTokenMock.mockResolvedValue("mock-token");
    requireAccessTokenMock.mockResolvedValue("mock-token");
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
    expect(
      screen.getAllByText(/assessing anomalies and preparing remediation notes/i).length
    ).toBeGreaterThan(0);
  });

  it("filters, sorts, paginates, and clears the run table", async () => {
    listTemplatesMock.mockResolvedValue([
      {
        id: "tpl-1",
        name: "Daily Ops Audit",
        description: "Ops checks",
        category: "operations",
        version: "1.0.0",
        stepCount: 2,
        configFieldCount: 1,
      },
      {
        id: "tpl-2",
        name: "Lead Routing",
        description: "Sales checks",
        category: "sales",
        version: "1.0.0",
        stepCount: 2,
        configFieldCount: 1,
      },
    ]);
    listRunsMock.mockResolvedValue([
      {
        id: "run_001",
        templateId: "tpl-1",
        templateName: "Daily Ops Audit",
        status: "completed",
        startedAt: "2026-04-15T09:00:00.000Z",
        completedAt: "2026-04-15T09:05:00.000Z",
        input: {},
        output: {},
        stepResults: [{ stepId: "a", stepName: "A", status: "success", durationMs: 1, output: {} }],
      },
      {
        id: "run_002",
        templateId: "tpl-2",
        templateName: "Lead Routing",
        status: "failed",
        startedAt: "2026-04-16T09:00:00.000Z",
        input: {},
        output: {},
        stepResults: [{ stepId: "b", stepName: "B", status: "failed", durationMs: 1, output: {} }],
      },
      {
        id: "run_003",
        templateId: "tpl-1",
        templateName: "Daily Ops Audit",
        status: "running",
        startedAt: "2026-04-17T09:00:00.000Z",
        input: {},
        output: {},
        stepResults: [{ stepId: "c", stepName: "C", status: "running", durationMs: 1, output: {} }],
      },
      {
        id: "run_004",
        templateId: "tpl-2",
        templateName: "Lead Routing",
        status: "pending",
        startedAt: "2026-04-18T09:00:00.000Z",
        input: {},
        output: {},
        stepResults: [{ stepId: "d", stepName: "D", status: "pending", durationMs: 1, output: {} }],
      },
      {
        id: "run_005",
        templateId: "tpl-1",
        templateName: "Daily Ops Audit",
        status: "completed",
        startedAt: "2026-04-19T09:00:00.000Z",
        input: {},
        output: {},
        stepResults: [{ stepId: "e", stepName: "E", status: "success", durationMs: 1, output: {} }],
      },
      {
        id: "run_006",
        templateId: "tpl-2",
        templateName: "Lead Routing",
        status: "completed",
        startedAt: "2026-04-20T09:00:00.000Z",
        input: {},
        output: {},
        stepResults: [{ stepId: "f", stepName: "F", status: "success", durationMs: 1, output: {} }],
      },
    ]);

    render(
      <MemoryRouter>
        <RunHistory />
      </MemoryRouter>
    );

    expect(await screen.findByText("6 runs found")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("run_006")).toBeInTheDocument();
    expect(screen.queryByText("run_001")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(screen.getByText("run_001")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/run id or workflow name/i), {
      target: { value: "lead" },
    });
    expect(await screen.findByText("3 runs found")).toBeInTheDocument();
    expect(screen.queryByText("run_005")).not.toBeInTheDocument();

    fireEvent.change(screen.getAllByRole("combobox")[0], {
      target: { value: "failed" },
    });
    expect(await screen.findByText("1 run found")).toBeInTheDocument();
    expect(screen.getByText("run_002")).toBeInTheDocument();

    fireEvent.change(screen.getAllByRole("combobox")[1], {
      target: { value: "tpl-1" },
    });
    expect((await screen.findAllByText(/no runs match your filters/i)).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(await screen.findByText("6 runs found")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /templateName/i }));
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("Lead Routing")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /templateName/i }));
    const descRows = screen.getAllByRole("row");
    expect(within(descRows[1]).getByText("Daily Ops Audit")).toBeInTheDocument();

    const dateInputs = document.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], {
      target: { value: "2026-04-19" },
    });
    fireEvent.change(dateInputs[1], {
      target: { value: "2026-04-19" },
    });
    expect(await screen.findByText("1 run found")).toBeInTheDocument();
    expect(screen.getByText("run_005")).toBeInTheDocument();
  });

  it("renders the error state and retries loading", async () => {
    listRunsMock.mockRejectedValueOnce(new Error("History failed"));
    listRunsMock.mockResolvedValueOnce([
      {
        id: "run_retry",
        templateId: "tpl-1",
        templateName: "Daily Ops Audit",
        status: "completed",
        startedAt: "2026-04-19T18:00:00.000Z",
        input: {},
        output: {},
        stepResults: [],
      },
    ]);

    render(
      <MemoryRouter>
        <RunHistory />
      </MemoryRouter>
    );

    expect(await screen.findByText("Run history unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("run_retry")).toBeInTheDocument();
    expect(listRunsMock).toHaveBeenCalledTimes(2);
  });
});
