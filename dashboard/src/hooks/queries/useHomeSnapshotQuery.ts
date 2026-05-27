import { useQuery } from "@tanstack/react-query";
import { fetchHomeSnapshot } from "../../api/snapshotApi";
import { queryKeys } from "../../lib/queryKeys";
import { useAuth } from "../../context/AuthContext";
import { useWorkspace } from "../../context/useWorkspace";
import { useResolveAccessToken } from "./resolveAccessToken";

export function useHomeSnapshotQuery() {
  const { accessMode } = useAuth();
  const resolveAccessToken = useResolveAccessToken();
  const { activeWorkspaceId } = useWorkspace();

  return useQuery({
    queryKey: queryKeys.home(activeWorkspaceId ?? "none"),
    queryFn: async () => {
      const token = await resolveAccessToken();
      return fetchHomeSnapshot(token);
    },
    enabled: Boolean(activeWorkspaceId) && accessMode !== "preview",
    // SSE drives most refreshes via invalidateQueries. We still keep a
    // 30s background poll as a safety net for when the stream is
    // disconnected (CORS, hot-reload, etc.). Skips when tab is hidden.
    refetchInterval: () =>
      typeof document !== "undefined" && document.hidden ? false : 30_000,
    refetchIntervalInBackground: false,
  });
}
