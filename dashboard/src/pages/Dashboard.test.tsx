import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard";
import type {
  ObservabilityEvent,
  ObservabilityFeedPage,
  ObservabilityThroughputSnapshot,
} from "../api/observability";

const {
  getObservabilityThroughputMock,
  listObservabilityEventsMock,
  requireAccessTokenMock,
  streamObservabilityEventsMock,
} = vi.hoisted(() => ({
  getObservabilityThroughputMock: vi.fn(),
  listObservabilityEventsMock: vi.fn(),
  requireAccessTokenMock: vi.fn(),
  streamObservabilityEventsMock: vi.fn(),
}));

vi.mock("../api/observability", () => ({
  getObservabilityThroughput: getObservabilityThroughputMock,
  listObservabilityEvents: listObservabilityEventsMock,
  streamObservabilityEvents: streamObservabilityEventsMock,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    requireAccessToken: requireAccessTokenMock,
  }),
}));

const sampleEvents: ObservabilityEvent[] = [
  {
    id: "evt-2",
    sequence: "2",
    userId: "user-1",
    category: "alert",
    type: "alert.raised",
    actor: { type: "agent", id: "agent-2", label: "Routing Watcher" },
    subject: { type: "task", id: "task-9", label: "Signal drift alert" },
    summary: "Critical alert raised for execution latency.",
    payload: {},
    occurredAt: "2026-04-28T20:10:00.000Z",
  },
  {
    id: "evt-1",
    sequence: "1",
    userId: "user-1",
    category: "run",
    type: "run.started",
    actor: { type: "run", id: "run-1", label: "Lead intake run" },
    subject: { type: "execution", id: "exec-1", label: "Lead intake execution" },
    summary: "Lead intake workflow started.",
    payload: {},
    occurredAt: "2026-04-28T20:00:00.000Z",
  },
];

const sampleFeedPage: ObservabilityFeedPage = {
  events: sampleEvents,
  nextCursor: "2",
  hasMore: false,
  generatedAt: "2026-04-28T20:10:00.000Z",
};

const sampleThroughput: ObservabilityThroughputSnapshot = {
  windowHours: 24,
  generatedAt: "2026-04-28T20:10:00.000Z",
  summary: {
    createdCount: 8,
    completedCount: 6,
    blockedCount: 1,
    completionRate: 0.75,
  },
  buckets: [
    { bucketStart: "2026-04-28T14:00:00.000Z", createdCount: 1, completedCount: 1, blockedCount: 0 },
    { bucketStart: "2026-04-28T15:00:00.000Z", createdCount: 2, completedCount: 1, blockedCount: 0 },
    { bucketStart: "2026-04-28T16:00:00.000Z", createdCount: 0, completedCount: 1, blockedCount: 0 },
    { bucketStart: "2026-04-28T17:00:00.000Z", createdCount: 2, completedCount: 1, blockedCount: 1 },
    { bucketStart: "2026-04-28T18:00:00.000Z", createdCount: 1, completedCount: 1, blockedCount: 0 },
    { bucketStart: "2026-04-28T19:00:00.000Z", createdCount: 1, completedCount: 0, blockedCount: 0 },
    { bucketStart: "2026-04-28T20:00:00.000Z", createdCount: 1, completedCount: 1, blockedCount: 0 },
    { bucketStart: "2026-04-28T21:00:00.000Z", createdCount: 0, completedCount: 0, blockedCount: 0 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  requireAccessTokenMock.mockResolvedValue("mock-token");
  listObservabilityEventsMock.mockResolvedValue(sampleFeedPage);
  getObservabilityThroughputMock.mockResolvedValue(sampleThroughput);
  streamObservabilityEventsMock.mockImplementation(
    async (
      _accessToken: string,
      options: { onReady?: (event: { nextCursor: string | null; replayed: number; generatedAt: string }) => void }
    ) => {
      options.onReady?.({
        nextCursor: "2",
        replayed: 0,
        generatedAt: "2026-04-28T20:10:00.000Z",
      });
    }
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Dashboard", () => {
  it("loads throughput and feed data, then opens the live stream", async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    expect(
      await screen.findByText("Critical alert raised for execution latency.")
    ).toBeInTheDocument();
    expect(screen.getAllByText("6").length).toBeGreaterThan(0);

    expect(requireAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(listObservabilityEventsMock).toHaveBeenCalledWith("mock-token", {
      categories: undefined,
      limit: 20,
    });
    expect(getObservabilityThroughputMock).toHaveBeenCalledWith("mock-token", 24);
    expect(streamObservabilityEventsMock).toHaveBeenCalledWith(
      "mock-token",
      expect.objectContaining({
        after: "2",
        categories: undefined,
        limit: 100,
      })
    );
  });

  it("reloads the dashboard when feed filters or time range controls change", async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await screen.findByText("Activity updates as they happen");

    fireEvent.click(screen.getByRole("button", { name: "Alerts" }));
    await waitFor(() => {
      expect(listObservabilityEventsMock).toHaveBeenLastCalledWith("mock-token", {
        categories: ["alert"],
        limit: 20,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "6h" }));
    await waitFor(() => {
      expect(getObservabilityThroughputMock).toHaveBeenLastCalledWith("mock-token", 6);
    });
  });

  it("shows a reconnecting transport state when the live stream fails", async () => {
    streamObservabilityEventsMock.mockRejectedValue(new Error("stream offline"));

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await screen.findByText("Critical alert raised for execution latency.");

    await waitFor(() => {
      expect(screen.getByText("Recovering")).toBeInTheDocument();
      expect(screen.getByText(/reconnecting to live stream/i)).toBeInTheDocument();
    });
  });

  it("renders the error state and retries the initial load", async () => {
    listObservabilityEventsMock.mockRejectedValueOnce(new Error("Observability broke"));
    listObservabilityEventsMock.mockResolvedValueOnce(sampleFeedPage);

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    expect(await screen.findByText("Observability dashboard unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("Critical alert raised for execution latency.")).toBeInTheDocument();
    expect(listObservabilityEventsMock).toHaveBeenCalled();
  });
});
