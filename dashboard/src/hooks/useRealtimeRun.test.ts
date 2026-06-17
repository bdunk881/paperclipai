/**
 * useRealtimeRun (HEL-708) — token mint → EventSource → live status.
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

import { useRealtimeRun } from "./useRealtimeRun";

beforeEach(() => {
  vi.clearAllMocks();
  FakeEventSource.instances = [];
  requireAccessTokenMock.mockResolvedValue("tok");
  fetchTokenMock.mockResolvedValue({ token: "rt-token", runId: "run-1", expiresAt: "2026-06-04T10:00:00Z" });
  vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useRealtimeRun", () => {
  it("mints a scoped token, opens the stream, and folds events into status", async () => {
    const { result } = renderHook(() => useRealtimeRun("run-1"));

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.instances[0]!;
    expect(fetchTokenMock).toHaveBeenCalledWith("tok", "run-1");
    expect(es.url).toBe("/api/realtime/runs/run-1/stream?token=rt-token");

    await act(async () => {
      es.emit("open");
      es.emit("snapshot", { id: "run-1", status: "running", tags: ["t"], metadata: { stage: "fetch" } });
    });
    expect(result.current.connected).toBe(true);
    expect(result.current.status).toBe("running");
    expect(result.current.snapshot).toMatchObject({ id: "run-1", status: "running" });

    await act(async () => {
      es.emit("stream", { event: { kind: "run.lifecycle", phase: "completed", runId: "run-1" } });
    });
    expect(result.current.status).toBe("completed");
    expect(result.current.events).toHaveLength(1);
  });

  it("does nothing without a runId", async () => {
    renderHook(() => useRealtimeRun(null));
    await Promise.resolve();
    expect(fetchTokenMock).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("closes the EventSource on unmount", async () => {
    const { unmount } = renderHook(() => useRealtimeRun("run-1"));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.instances[0]!;
    unmount();
    expect(es.closed).toBe(true);
  });
});
