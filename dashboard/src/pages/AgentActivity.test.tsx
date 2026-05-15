/**
 * AgentActivity — HEL-60 v2 restyle tests.
 *
 * The page now sources from `listObservabilityEvents` (canonical
 * observability stream) and renders v2 chrome with tabs (Live / Today /
 * This week / All) and event rows with mono timestamps + initials avatar
 * + verb-summary copy.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgentActivity from "./AgentActivity";
import type { ObservabilityEvent, ObservabilityFeedPage } from "../api/observability";

const { requireAccessTokenMock, listObservabilityEventsMock } = vi.hoisted(() => ({
  requireAccessTokenMock: vi.fn(),
  listObservabilityEventsMock: vi.fn(),
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
    accessModeMock.mockReset();

    accessModeMock.mockReturnValue("authenticated");
    requireAccessTokenMock.mockResolvedValue("token-123");
    listObservabilityEventsMock.mockResolvedValue(makePage([]));
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
