/**
 * useWorkflowPresence — collaborative awareness hook (HEL-241C, v2).
 *
 * v1 was a single 5s POST that did write + read in one round-trip and
 * surfaced "who's here" avatars. v2 adds live cursors and a real-time
 * channel:
 *
 *   - Primary transport: SSE via EventSource. The server publishes a
 *     fresh peer snapshot on every upsert / remove. Cursors render
 *     close to live (sub-second).
 *
 *   - Fallback: if EventSource fails to open or errors twice in a row
 *     (corporate proxies that block SSE, browsers throttling background
 *     connections, etc.), the hook drops to adaptive polling. Cadence
 *     is 750ms while the local cursor is moving and 5s when idle —
 *     enough fidelity to feel collaborative without DDoS-ing the API.
 *
 *   - Writes: cursor / selection updates POST to the existing
 *     /presence endpoint, throttled to ~50ms. The write path is the
 *     same whether SSE or polling is the active read transport — the
 *     fallback just adds a periodic "and refetch peers too" call.
 *
 * The hook quietly no-ops when:
 *   - `workflowId` is null (the workflow hasn't been saved yet)
 *   - `accessToken` is null (user is unauthed)
 *   - the page is hidden (document.visibilityState !== "visible")
 *
 * Returns `{ peers, reportCursor }`. The consumer wires `reportCursor`
 * to canvas mouse movements; pass null when the pointer leaves the
 * canvas to clear the broadcast cursor for peers.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  heartbeatWorkflowPresence,
  workflowPresenceStreamUrl,
  type WorkflowPresenceCursor,
  type WorkflowPresencePeer,
} from "../api/workflowsApi";

interface UseWorkflowPresenceOptions {
  workflowId: string | null;
  accessToken: string | null;
  name: string;
  selectedStepId: string | null;
  /** Polling fallback interval when idle. Defaults to 5_000ms. */
  idlePollMs?: number;
  /** Polling fallback interval when the cursor is moving. Defaults to 750ms. */
  activePollMs?: number;
  /** Throttle window for outbound cursor POSTs. Defaults to 50ms. */
  cursorPostThrottleMs?: number;
  /**
   * Test seam — how many consecutive SSE failures before falling back
   * to polling. Defaults to 2 (gives the browser one reconnect attempt
   * for transient network blips).
   */
  maxSseFailures?: number;
  /** Test seam — delay before the in-band SSE reconnect attempt. */
  sseReconnectDelayMs?: number;
}

export interface UseWorkflowPresenceResult {
  peers: WorkflowPresencePeer[];
  /**
   * Report the local cursor's canvas-coordinate position. Pass `null`
   * to clear (mouse left the canvas).
   */
  reportCursor: (cursor: WorkflowPresenceCursor | null) => void;
  /**
   * Which transport the hook is currently using. Useful for tests
   * and the (optional) dev-only HUD; consumers usually ignore.
   */
  transport: "sse" | "polling" | "idle";
}

const CURSOR_MOVING_WINDOW_MS = 1_500;

export function useWorkflowPresence({
  workflowId,
  accessToken,
  name,
  selectedStepId,
  idlePollMs = 5_000,
  activePollMs = 750,
  cursorPostThrottleMs = 50,
  maxSseFailures = 2,
  sseReconnectDelayMs = 1_000,
}: UseWorkflowPresenceOptions): UseWorkflowPresenceResult {
  const [peers, setPeers] = useState<WorkflowPresencePeer[]>([]);
  const [transport, setTransport] = useState<"sse" | "polling" | "idle">("idle");

  // Refs hold the latest values of inputs that the long-running
  // SSE / polling loops need to read without re-subscribing every
  // render. Without this, every name / selection change would tear
  // down + rebuild the SSE connection.
  const nameRef = useRef(name);
  const selectedStepIdRef = useRef(selectedStepId);
  const cursorRef = useRef<WorkflowPresenceCursor | null>(null);
  const lastCursorMoveAtRef = useRef(0);
  const lastCursorPostAtRef = useRef(0);

  nameRef.current = name;
  selectedStepIdRef.current = selectedStepId;

  // The write-side POST is a stable reference exposed to the consumer.
  // Throttled internally so cursor jitter doesn't translate into an
  // API call per pixel.
  const postPresence = useCallback(
    async (force = false) => {
      if (!workflowId || !accessToken) return;
      const now = Date.now();
      if (!force && now - lastCursorPostAtRef.current < cursorPostThrottleMs) {
        return;
      }
      lastCursorPostAtRef.current = now;
      try {
        const res = await heartbeatWorkflowPresence(
          workflowId,
          {
            name: nameRef.current,
            selectedStepId: selectedStepIdRef.current,
            cursor: cursorRef.current,
          },
          accessToken,
        );
        // When SSE is the read transport we don't need this peer list
        // (it'll arrive via the stream). But if we're in polling
        // fallback, this is the read.
        setPeers((current) => {
          // Don't overwrite a fresher SSE-delivered peer list with a
          // (potentially stale) POST response.
          if (transportRef.current === "sse") return current;
          return res.peers;
        });
      } catch {
        // Best-effort; the next call will retry.
      }
    },
    [workflowId, accessToken, cursorPostThrottleMs],
  );

  // Mirror transport state into a ref so postPresence (above) can read
  // it without being re-created on every transition.
  const transportRef = useRef(transport);
  transportRef.current = transport;

  const reportCursor = useCallback(
    (cursor: WorkflowPresenceCursor | null) => {
      cursorRef.current = cursor;
      if (cursor) lastCursorMoveAtRef.current = Date.now();
      void postPresence();
    },
    [postPresence],
  );

  // ---------------------------------------------------------------
  // Read transport: SSE first, polling fallback.
  // ---------------------------------------------------------------
  useEffect(() => {
    if (!workflowId || !accessToken) {
      setPeers([]);
      setTransport("idle");
      return;
    }

    let cancelled = false;
    let eventSource: EventSource | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let sseFailures = 0;

    const stopPolling = (): void => {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    };

    const schedulePoll = (): void => {
      if (cancelled) return;
      const isActive =
        Date.now() - lastCursorMoveAtRef.current < CURSOR_MOVING_WINDOW_MS;
      const delay = isActive ? activePollMs : idlePollMs;
      pollTimer = setTimeout(pollOnce, delay);
    };

    const pollOnce = async (): Promise<void> => {
      if (cancelled) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        schedulePoll();
        return;
      }
      // Force=true here because POST is the read in polling mode and
      // we want a fresh peer list every cycle, even if the cursor
      // hasn't moved recently enough to clear the throttle.
      await postPresence(true);
      schedulePoll();
    };

    const startPolling = (): void => {
      if (pollTimer) return;
      setTransport("polling");
      void pollOnce();
    };

    const connectSse = (): void => {
      if (typeof EventSource === "undefined") {
        startPolling();
        return;
      }
      try {
        eventSource = new EventSource(
          workflowPresenceStreamUrl(workflowId, accessToken),
        );
      } catch {
        startPolling();
        return;
      }

      eventSource.addEventListener("presence", (ev: MessageEvent) => {
        try {
          const payload = JSON.parse(ev.data) as {
            peers?: WorkflowPresencePeer[];
          };
          if (Array.isArray(payload.peers) && !cancelled) {
            setPeers(payload.peers);
            sseFailures = 0;
            if (transportRef.current !== "sse") setTransport("sse");
          }
        } catch {
          // Bad payload — ignore, the next event will recover.
        }
      });

      eventSource.onerror = () => {
        sseFailures += 1;
        eventSource?.close();
        eventSource = null;
        if (cancelled) return;
        if (sseFailures >= maxSseFailures) {
          // Give up on SSE for this session — fall back to polling.
          startPolling();
          return;
        }
        // Quick reconnect attempt — handles transient hiccups
        // (network blip, server restart) without flipping transport.
        setTimeout(() => {
          if (!cancelled) connectSse();
        }, sseReconnectDelayMs);
      };

      // Send an immediate heartbeat so peers see us on the stream
      // without waiting for the first cursor move.
      void postPresence(true);
    };

    connectSse();

    // Independent heartbeat so peers don't reap us during long
    // periods of cursor stillness. Server TTL is 30s; ping every 15s
    // to leave plenty of margin.
    const heartbeatTimer = setInterval(() => {
      if (cancelled) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      void postPresence(true);
    }, 15_000);

    return () => {
      cancelled = true;
      eventSource?.close();
      stopPolling();
      clearInterval(heartbeatTimer);
    };
  }, [
    workflowId,
    accessToken,
    activePollMs,
    idlePollMs,
    maxSseFailures,
    sseReconnectDelayMs,
    postPresence,
  ]);

  return { peers, reportCursor, transport };
}
