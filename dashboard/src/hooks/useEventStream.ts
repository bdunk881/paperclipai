/**
 * useEventStream (HEL-218) — generic SSE subscriber hook.
 *
 * Wraps the cookie-less EventSource pattern the dashboard already uses
 * on the agent-trace and presence streams: pass the access token via
 * `?access_token=…` (the backend has a shim that promotes it into the
 * Authorization header). The hook handles connection lifecycle, JSON
 * parsing, and reconnect-on-error.
 *
 * Designed to plug into existing react-query pages — the typical
 * pattern is to call `queryClient.invalidateQueries(...)` from
 * `onMessage` so a single SSE notification refetches the cached list.
 * Pages that want the raw envelope (for live transcript rendering, run
 * lifecycle indicators, etc.) can read it via `onEnvelope`.
 *
 * Usage:
 *   useEventStream("/api/routines/stream", {
 *     onMessage: () => queryClient.invalidateQueries({queryKey: routinesKey})
 *   });
 */

import { useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";

const BASE_API = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

export interface StreamEnvelope {
  workspaceId: string;
  seq: number;
  at: string;
  event: { kind: string; [key: string]: unknown };
}

export interface UseEventStreamOptions {
  /** Called for every parsed envelope. Use to update local state. */
  onEnvelope?: (envelope: StreamEnvelope) => void;
  /**
   * Called for every parsed envelope BEFORE `onEnvelope`. Typically
   * used to invalidate a react-query cache so the list refetches.
   */
  onMessage?: (envelope: StreamEnvelope) => void;
  /**
   * Disable the subscription. Useful when the page hasn't loaded its
   * resource id yet (e.g. ticket detail before params resolve).
   */
  enabled?: boolean;
}

export function useEventStream(
  path: string | null,
  options: UseEventStreamOptions = {},
): void {
  const { requireAccessToken, accessMode } = useAuth();
  const optsRef = useRef(options);
  optsRef.current = options;
  const enabled = options.enabled !== false;

  useEffect(() => {
    if (!path || !enabled || accessMode === "preview") return;

    let cancelled = false;
    let eventSource: EventSource | null = null;

    void (async () => {
      try {
        const token = await requireAccessToken();
        if (cancelled) return;
        const url = new URL(`${BASE_API}${path}`, window.location.origin);
        url.searchParams.set("access_token", token);
        eventSource = new EventSource(url.toString());

        const handle = (ev: MessageEvent): void => {
          try {
            const env = JSON.parse(ev.data) as StreamEnvelope;
            const opts = optsRef.current;
            opts.onMessage?.(env);
            opts.onEnvelope?.(env);
          } catch {
            // Drop malformed payloads silently.
          }
        };

        // The backend emits events under the "stream" name; activity /
        // trace replay endpoints use "snapshot" + "trace". Listen to all
        // three so a single hook covers every stream the dashboard
        // consumes.
        eventSource.addEventListener("stream", handle);
        eventSource.addEventListener("trace", handle);
        eventSource.addEventListener("snapshot", handle);
        eventSource.onerror = () => {
          eventSource?.close();
        };
      } catch {
        // SSE unavailable — let the page fall back to polling.
      }
    })();

    return () => {
      cancelled = true;
      eventSource?.close();
    };
  }, [path, enabled, accessMode, requireAccessToken]);
}
