import { getApiBasePath } from "./baseUrl";
import type { WorkflowRun } from "../types/workflow";

const BASE = getApiBasePath();

function buildAuthHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

export interface RunsListResponse {
  runs: WorkflowRun[];
  total: number;
}

export async function listRunsByStatus(
  accessToken: string,
  status: string
): Promise<RunsListResponse> {
  const url = new URL(`${BASE}/runs`, window.location.origin);
  url.searchParams.set("status", status);
  const res = await fetch(url.toString(), { headers: buildAuthHeaders(accessToken) });
  if (!res.ok) throw new Error(`Failed to fetch runs (status=${status}): ${res.status}`);
  return res.json() as Promise<RunsListResponse>;
}

export async function retryRun(accessToken: string, runId: string): Promise<WorkflowRun> {
  const res = await fetch(`${BASE}/runs/${encodeURIComponent(runId)}/retry`, {
    method: "POST",
    headers: buildAuthHeaders(accessToken),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Retry failed: ${res.status}`);
  }
  return res.json() as Promise<WorkflowRun>;
}

/**
 * GET /api/runs/in-flight — the caller's non-terminal runs in the
 * active workspace. Powers the bottom-right RunTray.
 */
export async function listInFlightRuns(
  accessToken: string,
): Promise<RunsListResponse> {
  const res = await fetch(`${BASE}/runs/in-flight`, {
    headers: buildAuthHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch in-flight runs: ${res.status}`);
  }
  return res.json() as Promise<RunsListResponse>;
}

/**
 * DELETE /api/runs/:id/cancel — request cancellation. Server flips
 * status to `cancelling`; the worker converges to `canceled` on its
 * next checkpoint.
 */
export async function cancelRun(
  accessToken: string,
  runId: string,
): Promise<void> {
  const res = await fetch(
    `${BASE}/runs/${encodeURIComponent(runId)}/cancel`,
    {
      method: "DELETE",
      headers: buildAuthHeaders(accessToken),
    },
  );
  if (!res.ok && res.status !== 204) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Cancel failed: ${res.status}`);
  }
}
