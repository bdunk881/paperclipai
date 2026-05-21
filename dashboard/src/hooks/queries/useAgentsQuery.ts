import { useQuery } from "@tanstack/react-query";
import { listAgents } from "../../api/agentApi";
import { queryKeys } from "../../lib/queryKeys";
import { useAuth } from "../../context/AuthContext";
import { useWorkspace } from "../../context/useWorkspace";
import { useResolveAccessToken } from "./resolveAccessToken";

export function useAgentsQuery() {
  const { accessMode } = useAuth();
  const resolveAccessToken = useResolveAccessToken();
  const { activeWorkspaceId } = useWorkspace();

  return useQuery({
    queryKey: queryKeys.agents(activeWorkspaceId ?? "none"),
    queryFn: async () => {
      if (accessMode === "preview" || !activeWorkspaceId) {
        return [];
      }
      const token = await resolveAccessToken();
      return listAgents(token);
    },
    enabled: Boolean(activeWorkspaceId) && accessMode !== "preview",
  });
}
