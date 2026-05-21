import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listAgents } from "../api/agentApi";
import { getEntitlements, getOrgGraph } from "../api/canonicalApi";
import { queryKeys } from "../lib/queryKeys";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";

/**
 * Prefetch shared workspace reads when the active workspace changes so
 * Team / Budget / Home sidebars hit cache on first navigation.
 */
export function useWorkspaceBootstrap(): void {
  const queryClient = useQueryClient();
  const { getAccessToken, accessMode } = useAuth();
  const { activeWorkspaceId } = useWorkspace();

  useEffect(() => {
    if (!activeWorkspaceId || accessMode === "preview") {
      return;
    }

    let cancelled = false;

    void (async () => {
      const token = await getAccessToken();
      if (!token || cancelled) {
        return;
      }

      const wsId = activeWorkspaceId;
      await Promise.all([
        queryClient.prefetchQuery({
          queryKey: queryKeys.agents(wsId),
          queryFn: () => listAgents(token),
        }),
        queryClient.prefetchQuery({
          queryKey: queryKeys.orgGraph(wsId),
          queryFn: () => getOrgGraph(token),
        }),
        queryClient.prefetchQuery({
          queryKey: queryKeys.entitlements(wsId),
          queryFn: () => getEntitlements(token),
        }),
      ]);
    })();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, accessMode, getAccessToken, queryClient]);
}
