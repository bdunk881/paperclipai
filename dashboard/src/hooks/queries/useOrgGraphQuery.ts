import { useQuery } from "@tanstack/react-query";
import { getOrgGraph } from "../../api/canonicalApi";
import { queryKeys } from "../../lib/queryKeys";
import { useAuth } from "../../context/AuthContext";
import { useWorkspace } from "../../context/useWorkspace";
import { useResolveAccessToken } from "./resolveAccessToken";

export function useOrgGraphQuery() {
  const { accessMode } = useAuth();
  const resolveAccessToken = useResolveAccessToken();
  const { activeWorkspaceId } = useWorkspace();

  return useQuery({
    queryKey: queryKeys.orgGraph(activeWorkspaceId ?? "none"),
    queryFn: async () => {
      const token = await resolveAccessToken();
      return getOrgGraph(token);
    },
    enabled: Boolean(activeWorkspaceId) && accessMode !== "preview",
  });
}
