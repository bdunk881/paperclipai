import { useQuery } from "@tanstack/react-query";
import { listTickets } from "../../api/tickets";
import { queryKeys } from "../../lib/queryKeys";
import { useAuth } from "../../context/AuthContext";
import { useWorkspace } from "../../context/useWorkspace";
import { useResolveAccessToken } from "./resolveAccessToken";

export function useTicketsQuery() {
  const { accessMode } = useAuth();
  const resolveAccessToken = useResolveAccessToken();
  const { activeWorkspaceId } = useWorkspace();

  return useQuery({
    queryKey: queryKeys.tickets(activeWorkspaceId ?? "none"),
    queryFn: async () => {
      const token = await resolveAccessToken();
      return listTickets({ workspaceId: activeWorkspaceId ?? undefined }, token);
    },
    enabled: Boolean(activeWorkspaceId) && accessMode !== "preview",
  });
}
