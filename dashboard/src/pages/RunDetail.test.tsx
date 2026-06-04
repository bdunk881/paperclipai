/**
 * RunDetail (HEL-562) — run timeline / step drill-in.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const { getRunMock, replayMock, requireAccessTokenMock, navigateMock } = vi.hoisted(() => ({
  getRunMock: vi.fn(),
  replayMock: vi.fn(),
  requireAccessTokenMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  getRun: getRunMock,
  replayRunFromStep: replayMock,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ requireAccessToken: requireAccessTokenMock }),
}));

vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

import RunDetail from "./RunDetail";
import { ToastProvider } from "../components/ToastProvider";

function renderAt(runId: string) {
  return render(
    <MemoryRouter initialEntries={[`/runs/${runId}`]}>
      <ToastProvider>
        <Routes>
          <Route path="/runs/:runId" element={<RunDetail />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const failedRun = {
  id: "run-1",
  templateId: "t1",
  templateName: "Daily refund triage",
  status: "failed" as const,
  startedAt: "2026-06-04T09:00:00.000Z",
  completedAt: "2026-06-04T09:00:07.000Z",
  input: {},
  error: "Slack token expired",
  stepResults: [
    { stepId: "s1", stepName: "Fetch orders", status: "success" as const, output: { orders: 14 }, durationMs: 1100, costLog: { estimatedCostUsd: 0 } },
    { stepId: "s2", stepName: "Post to Slack", status: "failure" as const, output: {}, durationMs: 300, error: "401 Unauthorized" },
  ],
};

describe("RunDetail (HEL-562)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAccessTokenMock.mockResolvedValue("tok");
    getRunMock.mockResolvedValue(failedRun);
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders the run header + per-step timeline with statuses and errors", async () => {
    renderAt("run-1");
    await screen.findByRole("heading", { name: /Daily refund triage/i });
    expect(screen.getByText("Fetch orders")).toBeInTheDocument();
    expect(screen.getByText("Post to Slack")).toBeInTheDocument();
    expect(screen.getByText(/401 Unauthorized/)).toBeInTheDocument();
  });

  it("offers Replay from a failed step and navigates to the new run", async () => {
    replayMock.mockResolvedValue({ ...failedRun, id: "run-2", status: "queued" });
    renderAt("run-1");
    const replay = await screen.findByRole("button", { name: /Replay from here/i });
    fireEvent.click(replay);
    await waitFor(() => expect(replayMock).toHaveBeenCalledWith("run-1", 1, "tok"));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/runs/run-2"));
  });

  it("shows an error state when the run fails to load", async () => {
    getRunMock.mockRejectedValueOnce(new Error("Run not found: run-x"));
    renderAt("run-x");
    expect(await screen.findByText(/Couldn't load this run/i)).toBeInTheDocument();
  });
});
