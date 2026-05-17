/**
 * useAgentPresence — subscribes to the live agent-presence stream
 * (Wave 2b) for the active workspace and exposes a Map<agentId,
 * presence> the caller can render straight into a status pill.
 *
 * Transport selection:
 *   1. Prefer SSE (`GET /api/agents/presence/stream`) for real-time
 *      change events backed by Redis pub/sub.
 *   2. Fall back to polling `GET /api/agents/presence` every 10 s if
 *      SSE fails (older proxy, browser without EventSource, network
 *      blip during connect). The dashboard still feels live, just at
 *      poll resolution.
 *
 * Snapshot + update merging: the SSE `snapshot` event populates the
 * full Map on connect; subsequent `update` events overwrite the
 * matching agent's entry. Agents not in any payload are treated as
 * offline (Redis TTL lapsed) and pruned by the snapshot — that's
 * the offline signal.
 */

import { useEffect, useRef, useState } from "react";
import { getApiBasePath } from "../api/baseUrl";
import { useAuth } from "../context/AuthContext";

export type AgentPresenceState =
  | "working"
  | "idle"
  | "blocked"
  | "checking-in";

export interface AgentPresence {
  agentId: string;
  workspaceId: string;
  state: AgentPresenceState;
  currentTask: string | null;
  since: string;
  updatedAt: string;
}

const POLL_INTERVAL_MS = 10_000;

export function useAgentPresence(): Map<string, AgentPresence> {
  const { requireAccessToken } = useAuth();
  const [presence, setPresence] = useState<Map<string, AgentPresence>>(
    () => new Map(),
  );
  // We carry these in refs so the cleanup function can reach them
  // without rebinding the effect on every render — re-binding would
  // close + reopen the SSE stream and thrash Upstash subscribe quota.
  const cancelledRef = useRef(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollHandleRef = useRef<number | null>(null);

  useEffect(() => {
    cancelledRef.current = false;

    function applySnapshot(agents: AgentPresence[]): void {
      if (cancelledRef.current) return;
      const next = new Map<string, AgentPresence>();
      for (const a of agents) next.set(a.agentId, a);
      setPresence(next);
    }

    function applyUpdate(p: AgentPresence): void {
      if (cancelledRef.current) return;
      setPresence((prev) => {
        const next = new Map(prev);
        next.set(p.agentId, p);
        return next;
      });
    }

    function startPolling(token: string): void {
      // Defensive: never run two poll loops.
      if (pollHandleRef.current !== null) return;
      const tick = async (): Promise<void> => {
        try {
          const res = await fetch(`${getApiBasePath()}/agents/presence`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const body = (await res.json()) as { agents?: AgentPresence[] };
            applySnapshot(body.agents ?? []);
          }
        } catch {
          // Swallow — next tick will retry. Presence is a hint.
        }
      };
      void tick();
      pollHandleRef.current = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    }

    async function start(): Promise<void> {
      let token: string;
      try {
        token = await requireAccessToken();
      } catch {
        // No token → no presence. The page will render agents without
        // live status, which is the right fallback.
        return;
      }

      // Browsers' built-in EventSource doesn't support custom headers,
      // so we send the auth token as a query param. The backend route
      // is auth-gated by the same middleware as the rest of /api/agents,
      // which honors `?access_token=` via the existing auth middleware.
      // If the deploy env doesn't accept query auth, the EventSource
      // open will fail and we fall through to polling.
      const sseUrl = `${getApiBasePath()}/agents/presence/stream?access_token=${encodeURIComponent(
        token,
      )}`;

      let es: EventSource;
      try {
        es = new EventSource(sseUrl);
      } catch {
        startPolling(token);
        return;
      }
      eventSourceRef.current = es;

      es.addEventListener("snapshot", (ev) => {
        try {
          const body = JSON.parse((ev as MessageEvent).data) as {
            agents?: AgentPresence[];
          };
          applySnapshot(body.agents ?? []);
        } catch {
          // Malformed payload — ignore this snapshot.
        }
      });

      es.addEventListener("update", (ev) => {
        try {
          const body = JSON.parse((ev as MessageEvent).data) as {
            presence?: AgentPresence;
          };
          if (body.presence) applyUpdate(body.presence);
        } catch {
          // Malformed payload — ignore this update.
        }
      });

      es.addEventListener("error", () => {
        // EventSource fires `error` on temporary network blips AND on
        // permanent failures. We can't reliably tell the difference, so
        // policy: close + degrade to polling. A future poll will reopen
        // when the user navigates to the page again.
        es.close();
        if (eventSourceRef.current === es) {
          eventSourceRef.current = null;
        }
        if (!cancelledRef.current) {
          startPolling(token);
        }
      });
    }

    void start();

    return () => {
      cancelledRef.current = true;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (pollHandleRef.current !== null) {
        window.clearInterval(pollHandleRef.current);
        pollHandleRef.current = null;
      }
    };
  }, [requireAccessToken]);

  return presence;
}
