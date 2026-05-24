import { useQuery } from "@tanstack/react-query";
import { listObservabilityEvents } from "../../api/observability";
import { queryKeys } from "../../lib/queryKeys";
import { useAuth } from "../../context/AuthContext";
import { useWorkspace } from "../../context/useWorkspace";
import { useResolveAccessToken } from "./resolveAccessToken";

const FEED_LIMIT = 100;
export const OBSERVABILITY_FEED_TAB = "feed";

export function useObservabilityQuery() {
  const { accessMode } = useAuth();
  const resolveAccessToken = useResolveAccessToken();
  const { activeWorkspaceId } = useWorkspace();

  return useQuery({
    queryKey: queryKeys.observability(activeWorkspaceId ?? "none", OBSERVABILITY_FEED_TAB),
    queryFn: async () => {
      const token = await resolveAccessToken();
      const page = await listObservabilityEvents(token, { limit: FEED_LIMIT });
      return page.events;
    },
    enabled: Boolean(activeWorkspaceId) && accessMode !== "preview",
  });
}
