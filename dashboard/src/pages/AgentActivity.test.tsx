/**
 * AgentActivity — HEL-60 v2 restyle + HEL-110 Failed tab tests.
 *
 * The page now sources from `listObservabilityEvents` (canonical
 * observability stream) and renders v2 chrome with tabs (Live / Today /
 * This week / All) and event rows with mono timestamps + initials avatar
 * + verb-summary copy.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgentActivity from "./AgentActivity";
import type { ObservabilityEvent, ObservabilityFeedPage } from "../api/observability";
import type { WorkflowRun } from "../types/workflow";

const { requireAccessTokenMock, listObservabilityEventsMock, listRunsByStatusMock, retryRunMock } = vi.hoisted(() => ({
  requireAccessTokenMock: vi.fn(),
  listObservabilityEventsMock: vi.fn(),
  listRunsByStatusMock: vi.fn(),
  retryRunMock: vi.fn(),
}));
const accessModeMock = vi.fn();

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    accessMode: accessModeMock(),
    requireAccessToken: requireAccessTokenMock,
  }),
}));

vi.mock("../api/observability", () => ({
  listObservabilityEvents: listObservabilityEventsMock,
}));

vi.mock("../api/runsApi", () => ({
  listRunsByStatus: listRunsByStatusMock,
  retryRun: retryRunMock,
}));

function makeEvent(overrides: Partial<ObservabilityEvent> = {}): ObservabilityEvent {
  return {
    id: "evt-1",
    sequence: "1",
    userId: "usr-1",
    category: "run",
    type: "run.started",
    actor: { type: "agent", id: "agent-1", label: "Sales Agent" },
    subject: { type: "execution", id: "exec-1", label: "Outreach run" },
    summary: "outreach for 38 enterprise leads",
    payload: {},
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePage(events: ObservabilityEvent[]): ObservabilityFeedPage {
  return {
    events,
    nextCursor: events[0]?.sequence ?? null,
    hasMore: false,
    generatedAt: new Date().toISOString(),
  };
}

describe("AgentActivity (HEL-60 v2)", () => {
  beforeEach(() => {
    requireAccessTokenMock.mockReset();
    listObservabilityEventsMock.mockReset();
    listRunsByStatusMock.mockReset();
    retryRunMock.mockReset();
    accessModeMock.mockReset();

    accessModeMock.mockReturnValue("authenticated");
    requireAccessTokenMock.mockResolvedValue("token-123");
    listObservabilityEventsMock.mockResolvedValue(makePage([]));
    listRunsByStatusMock.mockResolvedValue({ runs: [], total: 0 });
    retryRunMock.mockResolvedValue({});
  });

  it("renders v2 chrome (page, head, h1, eyebrow, tabs, card)", async () => {
    listObservabilityEventsMock.mockResolvedValue(
      makePage([makeEvent({ id: "evt-a", actor: { type: "agent", id: "ag-1", label: "Alex" } })]),
    );

    const { container } = render(
      <MemoryRouter>
        <AgentActivity />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(container.querySelector(".af2-page")).not.toBeNull();
    });

    expect(container.querySelector(".af2-page-head")).not.toBeNull();
    expect(container.querySelector(".af2-eyebrow")).not.toBeNull();
    expect(container.querySelector("h1.af2-h1")).not.toBeNull();
    expect(container.querySelector(".af2-tabs")).not.toBeNull();
    expect(container.querySelector(".af2-card")).not.toBeNull();
  });

  it("shows the Activity heading and Run · Live eyebrow", async () => {
    render(
      <MemoryRouter>
        <AgentActivity />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Activity", level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/Run\s*·\s*Live/i)).toBeInTheDocument();
  });

  it("renders the four time-tab buttons", async () => {
    render(
      <MemoryRouter>
        <AgentActivity />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Activity", level: 1 });

    expect(screen.getByRole("button", { name: /Live \(live\)/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Today$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^This week$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^All$/ })).toBeInTheDocument();
  });

  it("renders event rows from listObservabilityEvents", async () => {
    listObservabilityEventsMock.mockResolvedValue(
      makePage([
        makeEvent({
          id: "evt-row",
          actor: { type: "agent", id: "ag-1", label: "Alex" },
          type: "run.started",
          summary: "outreach for 38 enterprise leads",
          occurredAt: new Date().toISOString(),
        }),
      ]),
    );

    render(
      <MemoryRouter>
        <AgentActivity />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Alex")).toBeInTheDocument();
    expect(screen.getByText(/outreach for 38 enterprise leads/)).toBeInTheDocument();
    // "Details →" CTA per row
    expect(screen.getAllByText(/Details/).length).toBeGreaterThan(0);
  });
});

function makeFailedRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run-aabbccdd-1234",
    templateId: "tpl-1",
    templateName: "Outreach Bot",
    status: "failed",
    startedAt: new Date().toISOString(),
    input: {},
    stepResults: [],
    failureReason: "LLM quota exceeded",
    failedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

describe("AgentActivity — Failed tab (HEL-110)", () => {
  beforeEach(() => {
    requireAccessTokenMock.mockReset();
    listObservabilityEventsMock.mockReset();
    listRunsByStatusMock.mockReset();
    retryRunMock.mockReset();
    accessModeMock.mockReset();

    accessModeMock.mockReturnValue("authenticated");
    requireAccessTokenMock.mockResolvedValue("token-123");
    listObservabilityEventsMock.mockResolvedValue(makePage([]));
    listRunsByStatusMock.mockResolvedValue({ runs: [], total: 0 });
    retryRunMock.mockResolvedValue({});
  });

  it("renders the Failed tab button", async () => {
    render(
      <MemoryRouter>
        <AgentActivity />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Activity", level: 1 });
    expect(screen.getByRole("button", { name: /^Failed$/ })).toBeInTheDocument();
  });

  it("shows the empty state when there are no failed runs", async () => {
    listRunsByStatusMock.mockResolvedValue({ runs: [], total: 0 });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <AgentActivity />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Activity", level: 1 });
    await user.click(screen.getByRole("button", { name: /^Failed$/ }));

    expect(await screen.findByText(/No failed runs/i)).toBeInTheDocument();
  });

  it("renders failed run rows with template name and failure reason", async () => {
    listRunsByStatusMock.mockResolvedValue({
      runs: [makeFailedRun({ id: "run-aabbccdd-1234", templateName: "Outreach Bot", failureReason: "LLM quota exceeded" })],
      total: 1,
    });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <AgentActivity />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Activity", level: 1 });
    await user.click(screen.getByRole("button", { name: /^Failed$/ }));

    expect(await screen.findByText("Outreach Bot")).toBeInTheDocument();
    expect(screen.getByText(/LLM quota exceeded/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Retry$/ })).toBeInTheDocument();
  });

  it("calls retryRun and removes the run from the list on success", async () => {
    const run = makeFailedRun({ id: "run-aabbccdd-1234", templateName: "Outreach Bot" });
    listRunsByStatusMock.mockResolvedValue({ runs: [run], total: 1 });
    retryRunMock.mockResolvedValue({ id: run.id, status: "queued" });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <AgentActivity />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Activity", level: 1 });
    await user.click(screen.getByRole("button", { name: /^Failed$/ }));
    await screen.findByText("Outreach Bot");

    await user.click(screen.getByRole("button", { name: /^Retry$/ }));

    await waitFor(() => {
      expect(screen.queryByText("Outreach Bot")).toBeNull();
    });
    expect(retryRunMock).toHaveBeenCalledWith("token-123", run.id);
  });

  it("shows error state when loadFailedRuns throws", async () => {
    listRunsByStatusMock.mockRejectedValue(new Error("Network error"));
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <AgentActivity />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Activity", level: 1 });
    await user.click(screen.getByRole("button", { name: /^Failed$/ }));

    expect(await screen.findByText(/Network error/i)).toBeInTheDocument();
  });

  it("shows empty activity message when no events match the Live tab", async () => {
    listObservabilityEventsMock.mockResolvedValue(makePage([]));

    render(
      <MemoryRouter>
        <AgentActivity />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/No activity matches this view yet/i)).toBeInTheDocument();
  });

  it("calls listRunsByStatus in preview mode without making real calls", async () => {
    accessModeMock.mockReturnValue("preview");
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <AgentActivity />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Activity", level: 1 });
    await user.click(screen.getByRole("button", { name: /^Failed$/ }));

    await screen.findByText(/No failed runs/i);
    expect(listRunsByStatusMock).not.toHaveBeenCalled();
  });
});
