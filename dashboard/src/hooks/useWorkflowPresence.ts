/**
 * useWorkflowPresence — collaborative awareness hook (HEL-241C).
 *
 * Polls the workflow presence endpoint every 5s while the workflow
 * is open. Each call sends the local user's state (currently
 * selected step + display name) and receives the live peer list.
 *
 * Why polling, not SSE/WebSocket:
 *   - 5s latency is fine for "who's here" avatars.
 *   - Zero new infrastructure — uses the same trackedFetch + auth
 *     plumbing as every other API call.
 *   - When the product validates demand for real-time cursors,
 *     swap this hook's implementation for SSE without touching the
 *     consumer (WorkflowBuilder + PresenceStack).
 *
 * The hook quietly no-ops when:
 *   - `workflowId` is null (the workflow hasn't been saved yet)
 *   - `accessToken` is null (user is unauthed)
 *   - the page is hidden (document.visibilityState !== "visible")
 *
 * The visibility check is the cheap version of "stop heart-beating
 * when the user is in another tab" — the server TTL takes care of
 * reaping after 30s. Saves bandwidth on tabs that aren't actively
 * being used.
 */
import { useEffect, useState } from "react";
import {
  heartbeatWorkflowPresence,
  type WorkflowPresencePeer,
} from "../api/workflowsApi";

interface UseWorkflowPresenceOptions {
  workflowId: string | null;
  accessToken: string | null;
  name: string;
  selectedStepId: string | null;
  /** Polling interval in ms. Defaults to 5_000. */
  intervalMs?: number;
}

export function useWorkflowPresence({
  workflowId,
  accessToken,
  name,
  selectedStepId,
  intervalMs = 5_000,
}: UseWorkflowPresenceOptions): { peers: WorkflowPresencePeer[] } {
  const [peers, setPeers] = useState<WorkflowPresencePeer[]>([]);

  useEffect(() => {
    if (!workflowId || !accessToken) {
      setPeers([]);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        timer = setTimeout(tick, intervalMs);
        return;
      }
      try {
        const res = await heartbeatWorkflowPresence(
          workflowId,
          { selectedStepId, name },
          accessToken,
        );
        if (!cancelled) setPeers(res.peers);
      } catch {
        // Swallow transient failures — presence is best-effort. The
        // next poll will retry naturally.
      }
      if (!cancelled) timer = setTimeout(tick, intervalMs);
    };

    // Kick off immediately so peers see the new joiner without waiting
    // a full interval.
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [workflowId, accessToken, name, selectedStepId, intervalMs]);

  return { peers };
}
