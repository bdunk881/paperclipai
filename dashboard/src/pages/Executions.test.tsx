/**
 * Executions (HEL-703) — list, filter, retry, drill-in link.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const { listRunsMock, retryRunMock, listTemplatesMock, requireAccessTokenMock } = vi.hoisted(() => ({
  listRunsMock: vi.fn(),
  retryRunMock: vi.fn(),
  listTemplatesMock: vi.fn(),
  requireAccessTokenMock: vi.fn(),
}));

vi.mock("../api/runsApi", () => ({
  listRuns: listRunsMock,
  retryRun: retryRunMock,
}));

vi.mock("../api/client", () => ({
  listTemplates: listTemplatesMock,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ requireAccessToken: requireAccessTokenMock }),
}));

import Executions from "./Executions";

const run = (overrides: Record<string, unknown> = {}) => ({
  id: "run-1",
  templateId: "t1",
  templateName: "Daily refund triage",
  status: "failed" as const,
  startedAt: "2026-06-04T09:00:00.000Z",
  completedAt: "2026-06-04T09:00:07.000Z",
  input: {},
  stepResults: [],
  tags: ["customer:acme"],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  requireAccessTokenMock.mockResolvedValue("tok");
  listTemplatesMock.mockResolvedValue([{ id: "t1", name: "Daily refund triage" }]);
  listRunsMock.mockResolvedValue({ runs: [run()], total: 1 });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/runs"]}>
      <Executions />
    </MemoryRouter>,
  );
}

describe("Executions (HEL-703)", () => {
  it("lists runs with status, workflow, and tags", async () => {
    renderPage();
    const row = await screen.findByTestId("execution-row");
    expect(within(row).getByText("Daily refund triage")).toBeInTheDocument();
    expect(within(row).getByText(/customer:acme/)).toBeInTheDocument();
    // a View → drill-in link points at the run timeline
    const link = within(row).getByRole("link", { name: /view/i });
    expect(link).toHaveAttribute("href", "/runs/run-1");
  });

  it("changing the status filter refetches with that status", async () => {
    renderPage();
    await screen.findByTestId("execution-row");
    // The status select is the first combobox in the filter bar.
    fireEvent.change(screen.getAllByRole("combobox")[0]!, { target: { value: "completed" } });
    await waitFor(() =>
      expect(listRunsMock).toHaveBeenCalledWith("tok", expect.objectContaining({ status: "completed" })),
    );
  });

  it("retries a failed run and reloads", async () => {
    retryRunMock.mockResolvedValue(run({ status: "queued" }));
    renderPage();
    await screen.findByTestId("execution-row");
    expect(listRunsMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(retryRunMock).toHaveBeenCalledWith("tok", "run-1"));
    await waitFor(() => expect(listRunsMock).toHaveBeenCalledTimes(2)); // reload after retry
  });

  it("shows an empty state when no runs match", async () => {
    listRunsMock.mockResolvedValue({ runs: [], total: 0 });
    renderPage();
    expect(await screen.findByText(/no executions match/i)).toBeInTheDocument();
  });
});
