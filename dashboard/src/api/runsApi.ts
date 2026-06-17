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

export interface RunsListFilters {
  status?: string;
  templateId?: string;
  /** AND-containment: a run must carry every tag (HEL-704). */
  tags?: string[];
}

/**
 * GET /api/runs with optional filters (HEL-703). Status / template / tags are
 * applied server-side; date-windowing is done client-side in the Executions
 * view. Newest first.
 */
export async function listRuns(
  accessToken: string,
  filters: RunsListFilters = {},
): Promise<RunsListResponse> {
  const url = new URL(`${BASE}/runs`, window.location.origin);
  if (filters.status) url.searchParams.set("status", filters.status);
  if (filters.templateId) url.searchParams.set("templateId", filters.templateId);
  if (filters.tags && filters.tags.length > 0) url.searchParams.set("tags", filters.tags.join(","));
  const res = await fetch(url.toString(), { headers: buildAuthHeaders(accessToken) });
  if (!res.ok) throw new Error(`Failed to fetch runs: ${res.status}`);
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

/** GET /api/runs?templateId=… — runs for a template, newest first. */
export async function listRunsByTemplate(
  accessToken: string,
  templateId: string,
): Promise<RunsListResponse> {
  const url = new URL(`${BASE}/runs`, window.location.origin);
  url.searchParams.set("templateId", templateId);
  const res = await fetch(url.toString(), { headers: buildAuthHeaders(accessToken) });
  if (!res.ok) throw new Error(`Failed to fetch runs: ${res.status}`);
  return res.json() as Promise<RunsListResponse>;
}

/**
 * POST /api/runs/from-node (HEL-693) — run the workflow from `fromStepId`,
 * reusing the cached upstream outputs of `sourceRunId` so unchanged upstream
 * nodes aren't re-run. Returns the new run id.
 */
export async function runFromNode(
  accessToken: string,
  body: { templateId: string; fromStepId: string; sourceRunId: string },
): Promise<{ runId: string }> {
  const res = await fetch(`${BASE}/runs/from-node`, {
    method: "POST",
    headers: { ...buildAuthHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Run-from-node failed: ${res.status}`);
  }
  return res.json() as Promise<{ runId: string }>;
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
