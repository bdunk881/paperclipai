import { useQuery } from "@tanstack/react-query";
import { listMissions } from "../../api/missionsApi";
import { queryKeys } from "../../lib/queryKeys";
import { useAuth } from "../../context/AuthContext";
import { useWorkspace } from "../../context/useWorkspace";
import { useResolveAccessToken } from "./resolveAccessToken";

export function useMissionsQuery() {
  const { accessMode } = useAuth();
  const resolveAccessToken = useResolveAccessToken();
  const { activeWorkspaceId } = useWorkspace();

  return useQuery({
    queryKey: queryKeys.missions(activeWorkspaceId ?? "none"),
    queryFn: async () => {
      if (!activeWorkspaceId) return [];
      const token = await resolveAccessToken();
      return listMissions(token);
    },
    enabled: Boolean(activeWorkspaceId) && accessMode !== "preview",
  });
}
