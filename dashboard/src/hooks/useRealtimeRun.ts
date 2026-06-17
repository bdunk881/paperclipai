/**
 * HEL-708: useRealtimeRun — subscribe to a run's live status over SSE using a
 * scoped, short-TTL realtime token (the trigger.dev react-hooks pattern).
 *
 * Flow: mint a token (authenticated POST), then open an EventSource to the
 * PUBLIC stream with the token in the URL (EventSource can't send headers). The
 * server sends a `snapshot` on connect and `stream` envelopes thereafter; we
 * fold run.lifecycle phases into a live `status`.
 *
 * This is the realtime-SDK core; useRealtimeRunsWithTag / useWaitToken build on
 * the same token + EventSource primitives.
 */
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { fetchRealtimeRunToken } from "../api/runsApi";
import { getApiBasePath } from "../api/baseUrl";
import type { WorkflowRun } from "../types/workflow";

export interface RealtimeRunSnapshot {
  id: string;
  status: WorkflowRun["status"];
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface UseRealtimeRunResult {
  status: WorkflowRun["status"] | null;
  snapshot: RealtimeRunSnapshot | null;
  events: unknown[];
  connected: boolean;
  error: string | null;
}

const PHASE_TO_STATUS: Record<string, WorkflowRun["status"]> = {
  started: "running",
  completed: "completed",
  failed: "failed",
  canceled: "canceled",
};

export function useRealtimeRun(runId: string | null | undefined): UseRealtimeRunResult {
  const { requireAccessToken } = useAuth();
  const [snapshot, setSnapshot] = useState<RealtimeRunSnapshot | null>(null);
  const [status, setStatus] = useState<WorkflowRun["status"] | null>(null);
  const [events, setEvents] = useState<unknown[]>([]);
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

        es.addEventListener("snapshot", (e: MessageEvent) => {
          if (cancelled) return;
          try {
            const snap = JSON.parse(e.data) as RealtimeRunSnapshot | null;
            if (snap) {
              setSnapshot(snap);
              setStatus(snap.status);
            }
          } catch {
            /* ignore malformed */
          }
        });

        es.addEventListener("stream", (e: MessageEvent) => {
          if (cancelled) return;
          try {
            const envelope = JSON.parse(e.data) as { event?: { kind?: string; phase?: string } };
            setEvents((prev) => [...prev, envelope]);
            const ev = envelope.event;
            if (ev?.kind === "run.lifecycle" && ev.phase && PHASE_TO_STATUS[ev.phase]) {
              setStatus(PHASE_TO_STATUS[ev.phase]!);
            }
          } catch {
            /* ignore malformed */
          }
        });

        es.addEventListener("error", () => {
          if (!cancelled) setConnected(false);
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Realtime connection failed");
      }
    })();

    return () => {
      cancelled = true;
      es?.close();
    };
  }, [runId, requireAccessToken]);

  return { status, snapshot, events, connected, error };
}
