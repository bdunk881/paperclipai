import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getObservabilityThroughput,
  listObservabilityEvents,
  streamObservabilityEvents,
} from "./observability";

const ACCESS_TOKEN = "token-123";

function mockFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })
  );
}

function lastFetchUrl(): string {
  const mock = vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>);
  return mock.mock.calls[0][0] as string;
}

function lastFetchOptions(): RequestInit {
  const mock = vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>);
  return (mock.mock.calls[0][1] ?? {}) as RequestInit;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("observability APIs", () => {
  it("lists feed items and throughput snapshots with auth headers", async () => {
    mockFetch({
      events: [
        {
          id: "evt-1",
          sequence: "1",
          userId: "user-1",
          category: "run",
          type: "run.started",
          actor: { type: "run", id: "run-1" },
          subject: { type: "execution", id: "exec-1" },
          summary: "Run started",
          payload: {},
          occurredAt: "2026-04-28T20:00:00.000Z",
        },
      ],
      nextCursor: "1",
      hasMore: false,
      generatedAt: "2026-04-28T20:00:00.000Z",
    });
    const feed = await listObservabilityEvents(ACCESS_TOKEN, {
      after: "7",
      categories: ["run", "alert"],
      limit: 20,
    });
    expect(feed.events).toHaveLength(1);
    expect(lastFetchUrl()).toBe("/api/observability/events?after=7&categories=run%2Calert&limit=20");
    expect((lastFetchOptions().headers as Record<string, string>).Authorization).toBe(
      `Bearer ${ACCESS_TOKEN}`
    );

    mockFetch({
      windowHours: 24,
      generatedAt: "2026-04-28T20:00:00.000Z",
      summary: { createdCount: 2, completedCount: 1, blockedCount: 0, completionRate: 0.5 },
      buckets: [],
    });
    const throughput = await getObservabilityThroughput(ACCESS_TOKEN, 24);
    expect(throughput.summary.createdCount).toBe(2);
    expect(lastFetchUrl()).toBe("/api/observability/throughput?windowHours=24");
  });

  it("parses SSE stream events, ready events, and keepalives", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(
            [
              "id: 10",
              "event: run.started",
              'data: {"id":"evt-10","sequence":"10","userId":"user-1","category":"run","type":"run.started","actor":{"type":"run","id":"run-1"},"subject":{"type":"execution","id":"exec-1"},"summary":"Run started","payload":{},"occurredAt":"2026-04-28T20:00:00.000Z"}',
              "",
              "event: observability.ready",
              'data: {"nextCursor":"10","replayed":1,"generatedAt":"2026-04-28T20:00:00.000Z"}',
              "",
              "event: observability.keepalive",
              'data: {"generatedAt":"2026-04-28T20:00:15.000Z"}',
              "",
            ].join("\n")
          )
        );
        controller.close();
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body,
      })
    );

    const onEvent = vi.fn();
    const onReady = vi.fn();
    const onKeepalive = vi.fn();

    await streamObservabilityEvents(ACCESS_TOKEN, {
      categories: ["run"],
      limit: 100,
      onEvent,
      onReady,
      onKeepalive,
    });

    expect(lastFetchUrl()).toBe("/api/observability/events/stream?categories=run&limit=100");
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "evt-10",
        sequence: "10",
        category: "run",
        type: "run.started",
      })
    );
    expect(onReady).toHaveBeenCalledWith(
      expect.objectContaining({
        nextCursor: "10",
        replayed: 1,
      })
    );
    expect(onKeepalive).toHaveBeenCalledWith(
      expect.objectContaining({
        generatedAt: "2026-04-28T20:00:15.000Z",
      })
    );
  });
});
