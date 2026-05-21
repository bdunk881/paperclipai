import { useEffect, useRef, useState } from "react";
import {
  listAgentTraceEvents,
  openAgentTraceEventSource,
  type AgentTraceEnvelope,
} from "../api/agentTrace";
import { useAuth } from "../context/AuthContext";

/**
 * Subscribe to live trace events for a single agent run.
 */
export function useAgentTraceStream(runId: string | null): AgentTraceEnvelope[] {
  const { requireAccessToken, accessMode } = useAuth();
  const [events, setEvents] = useState<AgentTraceEnvelope[]>([]);
  const lastSeqRef = useRef(0);

  useEffect(() => {
    if (!runId || accessMode === "preview") {
      setEvents([]);
      lastSeqRef.current = 0;
      return;
    }

    let cancelled = false;
    let eventSource: EventSource | null = null;

    const merge = (incoming: AgentTraceEnvelope[]): void => {
      if (incoming.length === 0) return;
      setEvents((prev) => {
        const bySeq = new Map(prev.map((e) => [e.seq, e]));
        for (const e of incoming) {
          if (e.seq > lastSeqRef.current) lastSeqRef.current = e.seq;
          bySeq.set(e.seq, e);
        }
        return Array.from(bySeq.values()).sort((a, b) => a.seq - b.seq);
      });
    };

    void (async () => {
      try {
        const token = await requireAccessToken();
        const replay = await listAgentTraceEvents(token, runId, 0);
        if (!cancelled) merge(replay);

        eventSource = openAgentTraceEventSource(token, runId);
        eventSource.addEventListener("snapshot", (ev) => {
          try {
            const data = JSON.parse((ev as MessageEvent).data) as {
              events?: AgentTraceEnvelope[];
            };
            if (data.events) merge(data.events);
          } catch {
            // ignore
          }
        });
        eventSource.addEventListener("trace", (ev) => {
          try {
            const envelope = JSON.parse((ev as MessageEvent).data) as AgentTraceEnvelope;
            merge([envelope]);
          } catch {
            // ignore
          }
        });
        eventSource.onerror = () => {
          eventSource?.close();
        };
      } catch {
        // SSE unavailable — replay-only.
      }
    })();

    return () => {
      cancelled = true;
      eventSource?.close();
    };
  }, [runId, accessMode, requireAccessToken]);

  return events;
}
