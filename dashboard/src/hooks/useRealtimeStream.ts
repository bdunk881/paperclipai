/**
 * HEL-709: useRealtimeStream — consume a named, typed per-run stream over SSE
 * using a scoped realtime token (the trigger.dev streams + useRealtimeStream
 * pattern). Builds on the HEL-708 token + public stream: mint a token, open an
 * EventSource, and accumulate the chunks of one named stream
 * (e.g. `useRealtimeStream<RunProgressChunk>(runId, "progress")`).
 *
 * `T` is the producer↔consumer contract (defineRunStream<T> on the server); the
 * transport is JSON, so a malformed chunk is simply dropped.
 */
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { fetchRealtimeRunToken } from "../api/runsApi";
import { getApiBasePath } from "../api/baseUrl";

export interface UseRealtimeStreamResult<T> {
  chunks: T[];
  connected: boolean;
  error: string | null;
}

export function useRealtimeStream<T = unknown>(
  runId: string | null | undefined,
  streamName: string,
): UseRealtimeStreamResult<T> {
  const { requireAccessToken } = useAuth();
  const [chunks, setChunks] = useState<T[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let es: EventSource | null = null;

    void (async () => {
      try {
        const accessToken = await requireAccessToken();
        const { token } = await fetchRealtimeRunToken(accessToken, runId);
        if (cancelled) return;

        const url = `${getApiBasePath()}/realtime/runs/${encodeURIComponent(runId)}/stream?token=${encodeURIComponent(token)}`;
        es = new EventSource(url);

        es.addEventListener("open", () => {
          if (!cancelled) setConnected(true);
        });

        es.addEventListener("stream", (e: MessageEvent) => {
          if (cancelled) return;
          try {
            const envelope = JSON.parse(e.data) as {
              event?: { kind?: string; streamName?: string; chunk?: unknown };
            };
            const ev = envelope.event;
            if (ev?.kind === "stream.chunk" && ev.streamName === streamName) {
              setChunks((prev) => [...prev, ev.chunk as T]);
            }
          } catch {
            /* ignore malformed */
          }
        });

        es.addEventListener("error", () => {
          if (!cancelled) setConnected(false);
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Realtime stream failed");
      }
    })();

    return () => {
      cancelled = true;
      es?.close();
    };
  }, [runId, streamName, requireAccessToken]);

  return { chunks, connected, error };
}
