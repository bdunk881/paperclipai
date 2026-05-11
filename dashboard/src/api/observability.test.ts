import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function importWithMock() {
  vi.stubEnv("VITE_USE_MOCK", "true");
  vi.stubGlobal("fetch", vi.fn());
  return import("./observability");
}

async function importWithoutMock() {
  vi.stubGlobal("location", { origin: "http://localhost", hostname: "localhost" });
  return import("./observability");
}

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })
  );
}

function makeSseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

// ---------------------------------------------------------------------------
// observability mock mode
// ---------------------------------------------------------------------------
describe("observability mock mode", () => {
  it("returns mock events without fetching", async () => {
    const observability = await importWithMock();

    const page = await observability.listObservabilityEvents("mock-token", {
      categories: ["alert"],
      limit: 5,
    });

    expect(page.events).toHaveLength(1);
    expect(page.events[0]?.category).toBe("alert");
    expect(vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("returns a mock throughput snapshot without fetching", async () => {
    const observability = await importWithMock();

    const snapshot = await observability.getObservabilityThroughput("mock-token", 6);

    expect(snapshot.windowHours).toBe(6);
    expect(snapshot.summary.completedCount).toBeGreaterThan(0);
    expect(vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("emits a ready event for the mock stream without fetching", async () => {
    const observability = await importWithMock();
    const controller = new AbortController();
    const onReady = vi.fn();

    const streamPromise = observability.streamObservabilityEvents("mock-token", {
      signal: controller.signal,
      limit: 20,
      onEvent: vi.fn(),
      onReady,
    });

    expect(onReady).toHaveBeenCalledWith(
      expect.objectContaining({
        replayed: expect.any(Number),
        nextCursor: expect.any(String),
      })
    );

    controller.abort();
    await streamPromise;
    expect(vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("filters events by 'after' cursor", async () => {
    const observability = await importWithMock();
    const page = await observability.listObservabilityEvents("mock-token", { after: "9002" });
    expect(page.events.every((e) => Number(e.sequence) > 9002)).toBe(true);
    expect(page.events).toHaveLength(1);
  });

  it("respects the limit option", async () => {
    const observability = await importWithMock();
    const page = await observability.listObservabilityEvents("mock-token", { limit: 1 });
    expect(page.events).toHaveLength(1);
    expect(page.hasMore).toBe(true);
  });

  it("mock stream resolves immediately when signal is already aborted", async () => {
    const observability = await importWithMock();
    const controller = new AbortController();
    controller.abort();

    await expect(
      observability.streamObservabilityEvents("mock-token", {
        signal: controller.signal,
        onEvent: vi.fn(),
      })
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// listObservabilityEvents — non-mock path
// ---------------------------------------------------------------------------
describe("listObservabilityEvents (non-mock)", () => {
  it("fetches from the API and returns the page", async () => {
    const PAGE = { events: [], nextCursor: null, hasMore: false, generatedAt: "2026-01-01T00:00:00Z" };
    mockFetch(200, PAGE);
    const observability = await importWithoutMock();
    const result = await observability.listObservabilityEvents("tok");
    expect(result).toEqual(PAGE);
    expect(vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });

  it("includes 'after', 'categories', and 'limit' query params when provided", async () => {
    mockFetch(200, { events: [], nextCursor: null, hasMore: false, generatedAt: "" });
    const observability = await importWithoutMock();
    await observability.listObservabilityEvents("tok", {
      after: "500",
      categories: ["run", "alert"],
      limit: 10,
    });
    const fetchMock = vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>);
    const url: string = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("after=500");
    expect(url).toContain("categories=run%2Calert");
    expect(url).toContain("limit=10");
  });

  it("throws on non-ok response", async () => {
    mockFetch(500, {});
    const observability = await importWithoutMock();
    await expect(observability.listObservabilityEvents("tok")).rejects.toThrow(/500/);
  });
});

// ---------------------------------------------------------------------------
// getObservabilityThroughput — non-mock path
// ---------------------------------------------------------------------------
describe("getObservabilityThroughput (non-mock)", () => {
  it("fetches throughput snapshot from the API", async () => {
    const SNAPSHOT = {
      windowHours: 24,
      generatedAt: "2026-01-01T00:00:00Z",
      summary: { createdCount: 1, completedCount: 1, blockedCount: 0, completionRate: 1 },
      buckets: [],
    };
    mockFetch(200, SNAPSHOT);
    const observability = await importWithoutMock();
    const result = await observability.getObservabilityThroughput("tok", 24);
    expect(result).toEqual(SNAPSHOT);
  });

  it("throws on non-ok response", async () => {
    mockFetch(503, {});
    const observability = await importWithoutMock();
    await expect(observability.getObservabilityThroughput("tok")).rejects.toThrow(/503/);
  });
});

// ---------------------------------------------------------------------------
// getObservability
// ---------------------------------------------------------------------------
describe("getObservability", () => {
  it("returns observability records on success", async () => {
    const RESP = { records: [], total: 0, filters: { agents: [], tasks: [] }, aggregates: { totalCostUsd: 0, perAgent: [], perTask: [] } };
    mockFetch(200, RESP);
    const observability = await importWithoutMock();
    const result = await observability.getObservability("tok", { agentId: "a1" });
    expect(result).toEqual(RESP);
  });

  it("throws with error from response body on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "Forbidden" }),
    }));
    const observability = await importWithoutMock();
    await expect(observability.getObservability("tok")).rejects.toThrow("Forbidden");
  });

  it("throws with fallback message when body has no error field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => null,
    }));
    const observability = await importWithoutMock();
    await expect(observability.getObservability("tok")).rejects.toThrow(/500/);
  });
});

// ---------------------------------------------------------------------------
// streamObservabilityEvents — non-mock error paths
// ---------------------------------------------------------------------------
describe("streamObservabilityEvents (non-mock) error paths", () => {
  it("throws when response is not ok", async () => {
    mockFetch(503, {});
    const observability = await importWithoutMock();
    await expect(
      observability.streamObservabilityEvents("tok", { onEvent: vi.fn() })
    ).rejects.toThrow(/503/);
  });

  it("throws when response has no body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
    }));
    const observability = await importWithoutMock();
    await expect(
      observability.streamObservabilityEvents("tok", { onEvent: vi.fn() })
    ).rejects.toThrow(/not available/i);
  });
});

// ---------------------------------------------------------------------------
// streamObservabilityEvents — non-mock SSE parsing
// ---------------------------------------------------------------------------
describe("streamObservabilityEvents (non-mock) SSE parsing", () => {
  it("emits ready, event, and keepalive SSE messages", async () => {
    const sseEvent = JSON.stringify({
      id: "evt-1",
      sequence: "100",
      userId: "u1",
      category: "run",
      type: "run.completed",
      actor: { type: "run", id: "r1", label: "Run" },
      subject: { type: "execution", id: "e1", label: "Exec" },
      summary: "done",
      payload: {},
      occurredAt: "2026-01-01T00:00:00Z",
    });
    const stream = makeSseStream([
      // comment line, blank line, ready event, event, keepalive
      ": heartbeat\n",
      `event: observability.ready\ndata: ${JSON.stringify({ nextCursor: "100", replayed: 1, generatedAt: "2026-01-01T00:00:00Z" })}\n\n`,
      `event: observability.event\ndata: ${sseEvent}\n\n`,
      `event: observability.keepalive\ndata: ${JSON.stringify({ generatedAt: "2026-01-01T00:00:01Z" })}\n\n`,
      `id: evt-1\nevent: observability.event\ndata: ${sseEvent}\n\n`,
    ]);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    }));

    const observability = await importWithoutMock();
    const onEvent = vi.fn();
    const onReady = vi.fn();
    const onKeepalive = vi.fn();

    await observability.streamObservabilityEvents("tok", { onEvent, onReady, onKeepalive });

    expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ nextCursor: "100" }));
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onKeepalive).toHaveBeenCalledWith(expect.objectContaining({ generatedAt: "2026-01-01T00:00:01Z" }));
  });

  it("handles SSE block with no-colon field (field name only)", async () => {
    const stream = makeSseStream([
      "data\n\n",
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    }));
    const observability = await importWithoutMock();
    const onEvent = vi.fn();
    await observability.streamObservabilityEvents("tok", { onEvent });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("concatenates multi-line data fields and emits correctly", async () => {
    // Two data: lines are joined with \n; the combined string must be valid JSON
    const stream = makeSseStream([
      "event: observability.ready\ndata: {\"nextCursor\":null\ndata: ,\"replayed\":0,\"generatedAt\":\"2026-01-01T00:00:00Z\"}\n\n",
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    }));
    const observability = await importWithoutMock();
    const onReady = vi.fn();
    await observability.streamObservabilityEvents("tok", { onEvent: vi.fn(), onReady });
    expect(onReady).toHaveBeenCalledWith(
      expect.objectContaining({ nextCursor: null, replayed: 0 })
    );
  });

  it("skips SSE event when data JSON is unparseable", async () => {
    const stream = makeSseStream([
      "event: observability.event\ndata: not-json\n\n",
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    }));
    const observability = await importWithoutMock();
    const onEvent = vi.fn();
    await observability.streamObservabilityEvents("tok", { onEvent });
    expect(onEvent).not.toHaveBeenCalled();
  });
});
