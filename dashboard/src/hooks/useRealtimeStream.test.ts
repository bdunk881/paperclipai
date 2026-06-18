/**
 * useRealtimeStream (HEL-709) — token → EventSource → typed chunk accumulation.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchTokenMock, requireAccessTokenMock } = vi.hoisted(() => ({
  fetchTokenMock: vi.fn(),
  requireAccessTokenMock: vi.fn(),
}));

vi.mock("../api/runsApi", () => ({ fetchRealtimeRunToken: fetchTokenMock }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ requireAccessToken: requireAccessTokenMock }) }));
vi.mock("../api/baseUrl", () => ({ getApiBasePath: () => "/api" }));

type Listener = (e: { data?: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  private listeners: Record<string, Listener[]> = {};
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: Listener) {
    (this.listeners[type] ??= []).push(fn);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data?: unknown) {
    for (const fn of this.listeners[type] ?? []) {
      fn({ data: data === undefined ? undefined : JSON.stringify(data) });
    }
  }
}

import { useRealtimeStream } from "./useRealtimeStream";

beforeEach(() => {
  vi.clearAllMocks();
  FakeEventSource.instances = [];
  requireAccessTokenMock.mockResolvedValue("tok");
  fetchTokenMock.mockResolvedValue({ token: "rt", runId: "run-1", expiresAt: "2026-06-04T10:00:00Z" });
  vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
});

afterEach(() => vi.unstubAllGlobals());

describe("useRealtimeStream", () => {
  it("accumulates only chunks of the named stream", async () => {
    const { result } = renderHook(() =>
      useRealtimeStream<{ index: number }>("run-1", "progress"),
    );

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.instances[0]!;
    expect(es.url).toBe("/api/realtime/runs/run-1/stream?token=rt");

    await act(async () => {
      es.emit("open");
      es.emit("stream", { event: { kind: "stream.chunk", runId: "run-1", streamName: "progress", chunk: { index: 0 } } });
      es.emit("stream", { event: { kind: "stream.chunk", runId: "run-1", streamName: "other", chunk: { index: 99 } } });
      es.emit("stream", { event: { kind: "run.lifecycle", phase: "completed", runId: "run-1" } });
      es.emit("stream", { event: { kind: "stream.chunk", runId: "run-1", streamName: "progress", chunk: { index: 1 } } });
    });

    expect(result.current.connected).toBe(true);
    expect(result.current.chunks).toEqual([{ index: 0 }, { index: 1 }]);
  });

  it("closes the EventSource on unmount", async () => {
    const { unmount } = renderHook(() => useRealtimeStream("run-1", "progress"));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.instances[0]!;
    unmount();
    expect(es.closed).toBe(true);
  });
});
