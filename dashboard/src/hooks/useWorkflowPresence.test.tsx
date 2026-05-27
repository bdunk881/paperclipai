/**
 * useWorkflowPresence tests — HEL-241C v2.
 *
 * Focuses on the new behaviors v2 layers on top of the v1 polling hook:
 *   - SSE opens against /presence/stream with the access token
 *   - SSE "presence" events update the peer list
 *   - SSE errors twice → fall back to adaptive polling (POST is the read)
 *   - reportCursor POSTs cursor coords (throttled)
 *   - hook quietly no-ops when workflowId / accessToken are null
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { render } from "../test/render";
import { useWorkflowPresence } from "./useWorkflowPresence";
import * as workflowsApi from "../api/workflowsApi";

interface FakeES {
  url: string;
  listeners: Record<string, Array<(ev: MessageEvent) => void>>;
  onerror: (() => void) | null;
  closed: boolean;
  close(): void;
  addEventListener(name: string, handler: (ev: MessageEvent) => void): void;
}

const created: FakeES[] = [];

class FakeEventSource implements FakeES {
  url: string;
  listeners: Record<string, Array<(ev: MessageEvent) => void>> = {};
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    created.push(this);
  }
  addEventListener(name: string, handler: (ev: MessageEvent) => void): void {
    (this.listeners[name] ||= []).push(handler);
  }
  close(): void {
    this.closed = true;
  }
}

const heartbeatMock = vi.spyOn(workflowsApi, "heartbeatWorkflowPresence");

beforeEach(() => {
  created.length = 0;
  heartbeatMock.mockReset();
  heartbeatMock.mockResolvedValue({ peers: [] });
  (globalThis as { EventSource: typeof EventSource }).EventSource =
    FakeEventSource as unknown as typeof EventSource;
});

afterEach(() => {
  vi.useRealTimers();
});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function Probe(props: {
  workflowId: string | null;
  accessToken: string | null;
  onResult?: (r: ReturnType<typeof useWorkflowPresence>) => void;
  maxSseFailures?: number;
  cursorPostThrottleMs?: number;
}) {
  const result = useWorkflowPresence({
    workflowId: props.workflowId,
    accessToken: props.accessToken,
    name: "Bryan",
    selectedStepId: null,
    // Default to 0 throttle for tests so reportCursor flushes on the
    // next microtask. Real callers stay on the 50ms default.
    cursorPostThrottleMs: props.cursorPostThrottleMs ?? 0,
    maxSseFailures: props.maxSseFailures,
  });
  props.onResult?.(result);
  return null;
}

describe("useWorkflowPresence (v2)", () => {
  it("does nothing when workflowId is null", async () => {
    render(<Probe workflowId={null} accessToken="tok" />);
    await flush();
    expect(created).toHaveLength(0);
    expect(heartbeatMock).not.toHaveBeenCalled();
  });

  it("does nothing when accessToken is null", async () => {
    render(<Probe workflowId="wf-1" accessToken={null} />);
    await flush();
    expect(created).toHaveLength(0);
  });

  it("opens an SSE stream against /presence/stream with the access token", async () => {
    render(<Probe workflowId="wf-1" accessToken="tok-xyz" />);
    await flush();
    expect(created).toHaveLength(1);
    const url = new URL(created[0]!.url);
    expect(url.pathname).toMatch(/\/workflows\/wf-1\/presence\/stream$/);
    expect(url.searchParams.get("access_token")).toBe("tok-xyz");
  });

  it("updates peers when a presence event arrives over SSE", async () => {
    let snapshot: ReturnType<typeof useWorkflowPresence> | undefined;
    render(
      <Probe
        workflowId="wf-1"
        accessToken="tok"
        onResult={(r) => {
          snapshot = r;
        }}
      />,
    );
    await flush();
    const handler = created[0]!.listeners.presence?.[0];
    expect(handler).toBeDefined();
    await act(async () => {
      handler!({
        data: JSON.stringify({
          peers: [
            {
              userId: "u2",
              name: "Alex",
              color: "#7BA05B",
              cursor: { x: 12, y: 34 },
              lastSeen: 0,
            },
          ],
        }),
      } as MessageEvent);
    });
    expect(snapshot!.peers).toHaveLength(1);
    expect(snapshot!.peers[0].userId).toBe("u2");
    expect(snapshot!.transport).toBe("sse");
  });

  it("falls back to polling once SSE failures exhaust the retry budget", async () => {
    let snapshot: ReturnType<typeof useWorkflowPresence> | undefined;
    render(
      <Probe
        workflowId="wf-1"
        accessToken="tok"
        // maxSseFailures=1 short-circuits the reconnect dance so the
        // test doesn't have to coordinate with the 1s setTimeout.
        // Production stays on the default 2 (allows one retry).
        maxSseFailures={1}
        onResult={(r) => {
          snapshot = r;
        }}
      />,
    );
    await flush();
    expect(created).toHaveLength(1);

    heartbeatMock.mockClear();
    await act(async () => {
      created[0]!.onerror?.();
    });

    expect(snapshot!.transport).toBe("polling");
    // Polling loop kicked off and POSTed as its "read" call.
    expect(heartbeatMock).toHaveBeenCalled();
  });

  it("reportCursor sends cursor coords on the next POST", async () => {
    let snapshot: ReturnType<typeof useWorkflowPresence> | undefined;
    render(
      <Probe
        workflowId="wf-1"
        accessToken="tok"
        onResult={(r) => {
          snapshot = r;
        }}
      />,
    );
    await flush();
    heartbeatMock.mockClear();
    await act(async () => {
      snapshot!.reportCursor({ x: 100, y: 200 });
    });
    expect(heartbeatMock).toHaveBeenCalledTimes(1);
    const [, payload] = heartbeatMock.mock.calls[0]!;
    expect(payload.cursor).toEqual({ x: 100, y: 200 });
  });

  it("reportCursor(null) clears the cursor in the next POST", async () => {
    let snapshot: ReturnType<typeof useWorkflowPresence> | undefined;
    render(
      <Probe
        workflowId="wf-1"
        accessToken="tok"
        onResult={(r) => {
          snapshot = r;
        }}
      />,
    );
    await flush();
    heartbeatMock.mockClear();
    await act(async () => {
      snapshot!.reportCursor(null);
    });
    expect(heartbeatMock).toHaveBeenCalled();
    const [, payload] = heartbeatMock.mock.calls[0]!;
    expect(payload.cursor).toBeNull();
  });

  it("closes the EventSource on unmount", async () => {
    const { unmount } = render(<Probe workflowId="wf-1" accessToken="tok" />);
    await flush();
    expect(created).toHaveLength(1);
    unmount();
    expect(created[0]!.closed).toBe(true);
  });
});
