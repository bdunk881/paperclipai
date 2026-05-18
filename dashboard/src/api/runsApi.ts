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
