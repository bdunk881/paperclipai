import { fetchHomeSnapshot } from "../api/snapshotApi";
import { listApprovals } from "../api/client";
import { listObservabilityEvents } from "../api/observability";
import { getOrgGraph, listBudgets } from "../api/canonicalApi";
import { getSupabaseStoredSession } from "../auth/supabaseAuth";
import { queryClient } from "../lib/queryClient";
import { queryKeys } from "../lib/queryKeys";
import { readStoredActiveWorkspaceId } from "../workspaces/workspaceStorage";

async function readAccessToken(): Promise<string | undefined> {
  try {
    const session = await getSupabaseStoredSession();
    return session?.accessToken;
  } catch {
    return undefined;
  }
}

function workspaceIdForLoader(): string {
  return readStoredActiveWorkspaceId() ?? "none";
}

export async function homeLoader(): Promise<unknown> {
  const token = await readAccessToken();
  const workspaceId = workspaceIdForLoader();
  if (!token) {
    return null;
  }
  return queryClient.ensureQueryData({
    queryKey: queryKeys.home(workspaceId),
    queryFn: () => fetchHomeSnapshot(token),
  });
}

export async function approvalsLoader(): Promise<unknown> {
  const token = await readAccessToken();
  const workspaceId = workspaceIdForLoader();
  if (!token) {
    return null;
  }
  return queryClient.ensureQueryData({
    queryKey: queryKeys.approvals(workspaceId),
    queryFn: () => listApprovals(token),
  });
}

export async function activityLoader(): Promise<unknown> {
  const token = await readAccessToken();
  const workspaceId = workspaceIdForLoader();
  if (!token) {
    return null;
  }
  return queryClient.ensureQueryData({
    queryKey: queryKeys.observability(workspaceId, "live"),
    queryFn: async () => {
      const page = await listObservabilityEvents(token, { limit: 100 });
      return page.events;
    },
  });
}

export async function orgStructureLoader(): Promise<unknown> {
  const token = await readAccessToken();
  const workspaceId = workspaceIdForLoader();
  if (!token) {
    return null;
  }
  await Promise.all([
    queryClient.ensureQueryData({
      queryKey: queryKeys.orgGraph(workspaceId),
      queryFn: () => getOrgGraph(token),
    }),
    queryClient.ensureQueryData({
      queryKey: queryKeys.budgets(workspaceId),
      queryFn: () => listBudgets(token),
    }),
  ]);
  return null;
}

export async function budgetDashboardLoader(): Promise<unknown> {
  const token = await readAccessToken();
  const workspaceId = workspaceIdForLoader();
  if (!token) {
    return null;
  }
  await queryClient.ensureQueryData({
    queryKey: queryKeys.budgets(workspaceId),
    queryFn: () => listBudgets(token),
  });
  return null;
}
