/**
 * useInFlightRuns — server-driven view of the caller's non-terminal
 * runs across the active workspace, kept fresh by the workspace
 * routines SSE stream. Powers the bottom-right RunTray so a run kicked
 * off on one device shows up on another.
 *
 * Source of truth: `GET /api/runs/in-flight` (we keep state on the
 * server, not in localStorage, so it travels). The SSE subscription is
 * just a cheap nudge — on any `run.lifecycle` event we invalidate the
 * query so the next fetch reflects the new status.
 */
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cancelRun, listInFlightRuns } from "../api/runsApi";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";
import { queryKeys } from "../lib/queryKeys";
import { useResolveAccessToken } from "./queries/resolveAccessToken";
import { useWorkspaceLiveStream } from "./useWorkspaceLiveStream";
import type { WorkflowRun } from "../types/workflow";

export interface UseInFlightRunsResult {
  runs: WorkflowRun[];
  loading: boolean;
  error: string | null;
  /** Mark a run as cancelled. Optimistically patches its status to "cancelling". */
  cancel: (runId: string) => Promise<void>;
  /** Force a fresh fetch. */
  refresh: () => void;
}

export function useInFlightRuns(): UseInFlightRunsResult {
  const { accessMode, getAccessToken } = useAuth();
  const resolveAccessToken = useResolveAccessToken();
  const { activeWorkspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const cacheKey = queryKeys.inFlightRuns(activeWorkspaceId ?? "none");

  const query = useQuery({
    queryKey: cacheKey,
    queryFn: async () => {
      const token = await resolveAccessToken();
      return listInFlightRuns(token);
    },
    enabled: Boolean(activeWorkspaceId) && accessMode !== "preview",
    // Polling fallback — the SSE invalidation drives most refreshes.
    refetchInterval: () =>
      typeof document !== "undefined" && document.hidden ? false : 20_000,
    refetchIntervalInBackground: false,
  });

  // SSE nudge: invalidate on any routine lifecycle event.
  useWorkspaceLiveStream({
    path: "routines/stream",
    enabled: Boolean(activeWorkspaceId),
    onEvent: (evt) => {
      if (evt.name === "heartbeat") return;
      void queryClient.invalidateQueries({ queryKey: cacheKey });
    },
  });

  const cancel = useCallback(
    async (runId: string) => {
      // Optimistic flip to "cancelling" so the tray updates instantly.
      queryClient.setQueryData(cacheKey, (prev: unknown) => {
        if (!prev || typeof prev !== "object") return prev;
        const payload = prev as { runs?: WorkflowRun[]; total?: number };
        if (!Array.isArray(payload.runs)) return prev;
        return {
          ...payload,
          runs: payload.runs.map((r) =>
            r.id === runId ? { ...r, status: "cancelling" as const } : r,
          ),
        };
      });
      try {
        const token = (await getAccessToken()) ?? "";
        if (!token) throw new Error("Not authenticated");
        await cancelRun(token, runId);
      } finally {
        void queryClient.invalidateQueries({ queryKey: cacheKey });
      }
    },
    [getAccessToken, queryClient, cacheKey],
  );

  return {
    runs: query.data?.runs ?? [],
    loading: query.isLoading,
    error:
      query.error instanceof Error
        ? query.error.message
        : query.error
          ? "Failed to load in-flight runs"
          : null,
    cancel,
    refresh: () => void queryClient.invalidateQueries({ queryKey: cacheKey }),
  };
}
