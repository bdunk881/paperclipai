/**
 * useWorkspaceLiveStream — subscribes to a workspace SSE endpoint
 * (e.g. `/api/activity-events/stream`) and surfaces both the connection
 * state and a stream of parsed events.
 *
 * The dashboard backend ships SSE endpoints behind a Bearer-auth
 * middleware, which means the built-in `EventSource` is out (no header
 * support). This implementation uses `fetch` + `ReadableStream` so we
 * can attach `Authorization` and parse text/event-stream frames
 * manually.
 *
 * Auto-reconnects with exponential backoff (1s → 30s) when the network
 * trips, pauses while the tab is hidden, and tears down cleanly when
 * the consumer unmounts or the workspace changes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBasePath } from "../api/baseUrl";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";

export type LiveConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error"
  | "closed";

export interface LiveStreamEvent {
  /** SSE event name. The shared handler emits `snapshot`, `event`, and `heartbeat`. */
  name: string;
  /** Parsed JSON payload, or the raw string if non-JSON. */
  data: unknown;
}

export interface UseWorkspaceLiveStreamOptions {
  /** Endpoint path under `/api/`, e.g. `activity-events/stream`. */
  path: string;
  /** Disable subscription (useful when the page is not visible). */
  enabled?: boolean;
  /** Fires for every parsed event. */
  onEvent?: (event: LiveStreamEvent) => void;
}

export interface UseWorkspaceLiveStreamResult {
  state: LiveConnectionState;
  /** Counter of events received since connection — handy for cache busting. */
  eventCount: number;
  /** Timestamp (ms) of the last received event. */
  lastEventAt: number | null;
  /** Manually drop and reconnect — used when the auth token refreshes. */
  reconnect: () => void;
}

const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

export function useWorkspaceLiveStream({
  path,
  enabled = true,
  onEvent,
}: UseWorkspaceLiveStreamOptions): UseWorkspaceLiveStreamResult {
  const { getAccessToken } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const [state, setState] = useState<LiveConnectionState>("idle");
  const [eventCount, setEventCount] = useState(0);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [generation, setGeneration] = useState(0);
  const onEventRef = useRef(onEvent);

  // Keep the latest onEvent callback without forcing reconnects.
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const reconnect = useCallback(() => setGeneration((n) => n + 1), []);

  useEffect(() => {
    if (!enabled || !activeWorkspaceId) {
      setState("idle");
      return;
    }

    let aborted = false;
    let controller: AbortController | null = null;
    let backoffTimer: number | null = null;
    let attempt = 0;

    async function connect() {
      if (aborted) return;
      controller = new AbortController();
      setState((prev) => (prev === "connected" ? "reconnecting" : "connecting"));

      let token: string | null = null;
      try {
        token = await getAccessToken();
      } catch {
        token = null;
      }
      if (!token) {
        setState("error");
        scheduleReconnect();
        return;
      }

      try {
        const url = `${getApiBasePath()}/${path.replace(/^\//, "")}`;
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
          },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`stream ${res.status}`);
        }
        setState("connected");
        attempt = 0;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // SSE frames are separated by a blank line.
          let separatorIdx: number;
          while ((separatorIdx = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, separatorIdx);
            buffer = buffer.slice(separatorIdx + 2);
            const parsed = parseSseFrame(frame);
            if (!parsed) continue;
            if (parsed.name !== "heartbeat") {
              setEventCount((n) => n + 1);
              setLastEventAt(Date.now());
            }
            onEventRef.current?.(parsed);
          }
        }
        // Server closed the stream cleanly — try to reconnect.
        if (!aborted) {
          setState("reconnecting");
          scheduleReconnect();
        } else {
          setState("closed");
        }
      } catch (err) {
        if (aborted || (err instanceof Error && err.name === "AbortError")) {
          setState("closed");
          return;
        }
        setState("error");
        scheduleReconnect();
      }
    }

    function scheduleReconnect() {
      if (aborted) return;
      const delay = Math.min(
        BACKOFF_START_MS * Math.pow(2, attempt),
        BACKOFF_MAX_MS,
      );
      attempt += 1;
      backoffTimer = window.setTimeout(() => {
        if (!aborted) void connect();
      }, delay);
    }

    void connect();

    // Pause when tab hidden, resume on visibility.
    function onVisibility() {
      if (typeof document === "undefined") return;
      if (document.hidden) {
        controller?.abort();
        if (backoffTimer != null) {
          window.clearTimeout(backoffTimer);
          backoffTimer = null;
        }
        setState("idle");
      } else {
        attempt = 0;
        void connect();
      }
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      aborted = true;
      controller?.abort();
      if (backoffTimer != null) window.clearTimeout(backoffTimer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      setState("closed");
    };
  }, [path, enabled, activeWorkspaceId, generation, getAccessToken]);

  return { state, eventCount, lastEventAt, reconnect };
}

function parseSseFrame(frame: string): LiveStreamEvent | null {
  // Each line is "field: value". We care about `event:` and `data:`.
  let name = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue; // comment / heartbeat
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const field = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).replace(/^ /, "");
    if (field === "event") name = value;
    else if (field === "data") dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  const rawData = dataLines.join("\n");
  let data: unknown = rawData;
  try {
    data = JSON.parse(rawData);
  } catch {
    /* leave as string */
  }
  return { name, data };
}
