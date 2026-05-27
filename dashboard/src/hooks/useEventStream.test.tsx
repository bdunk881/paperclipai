/**
 * useEventStream tests (HEL-218).
 *
 * Verifies the hook opens an EventSource against the given path with
 * the access token in the query, dispatches `stream` events to the
 * onMessage / onEnvelope callbacks, and closes the source on unmount.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../test/render";
import { useEventStream, type StreamEnvelope } from "./useEventStream";

const requireAccessTokenMock = vi.hoisted(() => vi.fn());

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u" },
    accessMode: "authenticated",
    requireAccessToken: requireAccessTokenMock,
  }),
}));

interface FakeEventSource {
  url: string;
  listeners: Record<string, Array<(ev: MessageEvent) => void>>;
  onerror: (() => void) | null;
  close: () => void;
  closed: boolean;
}

const created: FakeEventSource[] = [];

class FakeES {
  url: string;
  listeners: Record<string, Array<(ev: MessageEvent) => void>> = {};
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    created.push(this as unknown as FakeEventSource);
  }
  addEventListener(name: string, handler: (ev: MessageEvent) => void): void {
    (this.listeners[name] ||= []).push(handler);
  }
  close(): void {
    this.closed = true;
  }
}

beforeEach(() => {
  created.length = 0;
  requireAccessTokenMock.mockReset();
  requireAccessTokenMock.mockResolvedValue("test-token");
  (globalThis as { EventSource: typeof EventSource }).EventSource =
    FakeES as unknown as typeof EventSource;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function Probe({
  path,
  onMessage,
  enabled = true,
}: {
  path: string | null;
  onMessage?: (env: StreamEnvelope) => void;
  enabled?: boolean;
}) {
  useEventStream(path, { onMessage, enabled });
  return null;
}

async function flush(): Promise<void> {
  // Yield to the microtask queue twice so the hook's async
  // requireAccessToken() → EventSource construction cycle settles.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("useEventStream", () => {
  it("opens an EventSource on the given path with access_token=…", async () => {
    render(<Probe path="/api/routines/stream" />);
    await flush();
    expect(created).toHaveLength(1);
    const url = new URL(created[0]!.url);
    expect(url.pathname).toBe("/api/routines/stream");
    expect(url.searchParams.get("access_token")).toBe("test-token");
  });

  it("invokes onMessage for stream events", async () => {
    const onMessage = vi.fn();
    render(<Probe path="/api/routines/stream" onMessage={onMessage} />);
    await flush();
    const handler = created[0]!.listeners.stream?.[0];
    expect(handler).toBeDefined();
    const envelope: StreamEnvelope = {
      workspaceId: "ws-1",
      seq: 1,
      at: "2026-05-26T00:00:00Z",
      event: { kind: "run.lifecycle", phase: "started" },
    };
    handler!({ data: JSON.stringify(envelope) } as MessageEvent);
    expect(onMessage).toHaveBeenCalledWith(envelope);
  });

  it("silently drops malformed JSON payloads", async () => {
    const onMessage = vi.fn();
    render(<Probe path="/api/tickets/stream" onMessage={onMessage} />);
    await flush();
    const handler = created[0]!.listeners.stream?.[0];
    handler!({ data: "not-json" } as MessageEvent);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("does not subscribe when enabled=false", async () => {
    render(<Probe path="/api/routines/stream" enabled={false} />);
    await flush();
    expect(created).toHaveLength(0);
  });

  it("does not subscribe when path is null", async () => {
    render(<Probe path={null} />);
    await flush();
    expect(created).toHaveLength(0);
  });

  it("closes the EventSource on unmount", async () => {
    const { unmount } = render(<Probe path="/api/routines/stream" />);
    await flush();
    expect(created).toHaveLength(1);
    unmount();
    expect(created[0]!.closed).toBe(true);
  });
});
