import { useQuery } from "@tanstack/react-query";
import { listApprovals } from "../../api/client";
import { queryKeys } from "../../lib/queryKeys";
import { useAuth } from "../../context/AuthContext";
import { useWorkspace } from "../../context/useWorkspace";
import { useResolveAccessToken } from "./resolveAccessToken";

export function useApprovalsQuery() {
  const { accessMode } = useAuth();
  const resolveAccessToken = useResolveAccessToken();
  const { activeWorkspaceId } = useWorkspace();

  return useQuery({
    queryKey: queryKeys.approvals(activeWorkspaceId ?? "none"),
    queryFn: async () => {
      const token = await resolveAccessToken();
      return listApprovals(token);
    },
    enabled: Boolean(activeWorkspaceId) && accessMode !== "preview",
  });
}
