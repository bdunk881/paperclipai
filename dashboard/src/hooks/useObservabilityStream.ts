import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  listObservabilityEvents,
  streamObservabilityEvents,
  type ObservabilityEvent,
} from "../api/observability";
import { queryKeys } from "../lib/queryKeys";
import { useAuth } from "../context/AuthContext";
import { useResolveAccessToken } from "./queries/resolveAccessToken";
import { useWorkspace } from "../context/useWorkspace";

const FEED_LIMIT = 100;

/**
 * Live tab: SSE stream with polling fallback. Updates the TanStack cache
 * in place so the Activity page never full-reloads on each event.
 */
export function useObservabilityStream(enabled: boolean): void {
  const queryClient = useQueryClient();
  const { accessMode } = useAuth();
  const resolveAccessToken = useResolveAccessToken();
  const { activeWorkspaceId } = useWorkspace();
  const tabKey = "live";

  useEffect(() => {
    if (!enabled || !activeWorkspaceId || accessMode === "preview") {
      return;
    }

    const queryKey = queryKeys.observability(activeWorkspaceId, tabKey);
    let cancelled = false;
    const abort = new AbortController();

    const mergeEvent = (event: ObservabilityEvent) => {
      queryClient.setQueryData<ObservabilityEvent[]>(queryKey, (current) => {
        const prev = current ?? [];
        if (prev.some((entry) => entry.id === event.id)) {
          return prev;
        }
        return [event, ...prev].slice(0, FEED_LIMIT);
      });
    };

    void (async () => {
      try {
        const token = await resolveAccessToken();
        if (cancelled) return;

        await streamObservabilityEvents(token, {
          limit: FEED_LIMIT,
          signal: abort.signal,
          onEvent: mergeEvent,
          onReady: (ready) => {
            if (ready.replayed > 0) {
              return;
            }
          },
        });
      } catch {
        if (cancelled || abort.signal.aborted) {
          return;
        }
        const poll = async () => {
          try {
            const token = await resolveAccessToken();
            const page = await listObservabilityEvents(token, { limit: FEED_LIMIT });
            queryClient.setQueryData(queryKey, page.events);
          } catch {
            // silent — next interval retries
          }
        };
        void poll();
        const interval = window.setInterval(() => void poll(), 5_000);
        abort.signal.addEventListener("abort", () => window.clearInterval(interval), {
          once: true,
        });
      }
    })();

    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [enabled, activeWorkspaceId, accessMode, queryClient, resolveAccessToken]);
}
