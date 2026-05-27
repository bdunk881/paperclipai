/**
 * useIsPaidTier — true when the active workspace is on Flow tier or up
 * (Flow / Automate / Scale). The "explore" plan is the free trial tier
 * and gets the locked-out treatment for Pro features.
 *
 * Reads from the entitlements query that `useWorkspaceBootstrap` already
 * prefetches, so this is essentially a sync lookup against the cache.
 */
import { useQuery } from "@tanstack/react-query";
import { getEntitlements } from "../api/canonicalApi";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";
import { queryKeys } from "../lib/queryKeys";
import { useResolveAccessToken } from "./queries/resolveAccessToken";

const PAID_PLANS = new Set(["flow", "automate", "scale"]);

export function useIsPaidTier(): { isPaid: boolean; plan: string | null; loading: boolean } {
  const { accessMode } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const resolveAccessToken = useResolveAccessToken();

  const query = useQuery({
    queryKey: queryKeys.entitlements(activeWorkspaceId ?? "none"),
    queryFn: async () => {
      const token = await resolveAccessToken();
      return getEntitlements(token);
    },
    enabled: Boolean(activeWorkspaceId) && accessMode !== "preview",
    // Entitlements rarely change mid-session; trust the bootstrap prefetch.
    staleTime: 5 * 60_000,
  });

  const plan = query.data?.plan ?? null;
  return {
    isPaid: plan ? PAID_PLANS.has(plan) : false,
    plan,
    loading: query.isLoading,
  };
}
