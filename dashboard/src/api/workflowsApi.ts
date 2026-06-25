/**
 * Canonical workflows API client (HEL-27).
 *
 * Mirrors `src/workflows/workflowRoutes.ts`. Lives alongside the legacy
 * `createTemplate()` / `listTemplates()` calls in api/client.ts; the
 * dashboard's Studio dual-writes on save so the canonical store
 * (`workflows` + `workflow_versions`) fills up with real customer
 * routines as they get built.
 *
 * "Versions are immutable; edits create a new version" — calling
 * `createWorkflowVersion()` on an existing workflow id creates a brand
 * new `workflow_versions` row with `version = max + 1` and bumps
 * `workflows.latest_version_id`.
 */

import { getApiBasePath, getWorkflowDocWorkerOrigin } from "./baseUrl";
import { trackedFetch } from "./trackedFetch";

const BASE = getApiBasePath();

export interface CanonicalWorkflowVersion {
  id: string;
  version: number;
  dag: unknown;
  createdAt: string;
}

export interface CanonicalWorkflow {
  id: string;
  name: string;
  externalTemplateId: string | null;
  latestVersion: CanonicalWorkflowVersion | null;
  createdAt: string;
  updatedAt: string;
}

function buildHeaders(accessToken: string, extra?: HeadersInit): HeadersInit {
  return { ...(extra ?? {}), Authorization: `Bearer ${accessToken}` };
}

async function parseJsonOrError<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? fallback);
  }
  return response.json() as Promise<T>;
}

export async function createCanonicalWorkflow(
  input: { name: string; dag: unknown; externalTemplateId?: string },
  accessToken: string,
): Promise<CanonicalWorkflow> {
  const response = await trackedFetch(`${BASE}/workflows`, {
    method: "POST",
    headers: buildHeaders(accessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  return parseJsonOrError<CanonicalWorkflow>(
    response,
    `Failed to create workflow: ${response.status}`,
  );
}

export async function createCanonicalWorkflowVersion(
  workflowId: string,
  dag: unknown,
  accessToken: string,
): Promise<CanonicalWorkflowVersion> {
  const response = await trackedFetch(
    `${BASE}/workflows/${encodeURIComponent(workflowId)}/versions`,
    {
      method: "POST",
      headers: buildHeaders(accessToken, { "Content-Type": "application/json" }),
      body: JSON.stringify({ dag }),
    },
  );
  return parseJsonOrError<CanonicalWorkflowVersion>(
    response,
    `Failed to create workflow version: ${response.status}`,
  );
}

export async function getCanonicalWorkflow(
  workflowId: string,
  accessToken: string,
): Promise<CanonicalWorkflow | null> {
  const response = await trackedFetch(
    `${BASE}/workflows/${encodeURIComponent(workflowId)}`,
    { headers: buildHeaders(accessToken) },
  );
  if (response.status === 404) return null;
  return parseJsonOrError<CanonicalWorkflow>(
    response,
    `Failed to load workflow: ${response.status}`,
  );
}

export async function listCanonicalWorkflows(
  accessToken: string,
  options: { externalTemplateId?: string } = {},
): Promise<CanonicalWorkflow[]> {
  const params = new URLSearchParams();
  if (options.externalTemplateId) {
    params.set("externalTemplateId", options.externalTemplateId);
  }
  const qs = params.toString();
  const url = qs ? `${BASE}/workflows?${qs}` : `${BASE}/workflows`;
  const response = await trackedFetch(url, {
    headers: buildHeaders(accessToken),
  });
  const data = await parseJsonOrError<{ workflows: CanonicalWorkflow[] }>(
    response,
    `Failed to list workflows: ${response.status}`,
  );
  return data.workflows;
}

export interface CanonicalWorkflowVersionSummary {
  id: string;
  version: number;
  createdAt: string;
  isLatest: boolean;
}

export interface CanonicalWorkflowVersionDetail
  extends CanonicalWorkflowVersionSummary {
  dag: unknown;
}

// HEL-100 v2 Versions panel: returns the immutable version list for
// a workflow (newest first, up to 50). The list view is intentionally
// lighter than the full version row — it omits the dag blob so the
// panel renders fast even on workflows with many versions.
export async function listCanonicalWorkflowVersions(
  workflowId: string,
  accessToken: string,
): Promise<CanonicalWorkflowVersionSummary[]> {
  const response = await trackedFetch(
    `${BASE}/workflows/${encodeURIComponent(workflowId)}/versions`,
    { headers: buildHeaders(accessToken) },
  );
  const data = await parseJsonOrError<{
    workflowId: string;
    versions: CanonicalWorkflowVersionSummary[];
  }>(response, `Failed to list workflow versions: ${response.status}`);
  return data.versions;
}

// HEL-100 v2 Versions panel diff modal: fetches a single workflow_version
// with its full dag blob. Powers the side-by-side diff renderer + the
// restore flow (which pulls an older version's dag, then POSTs it back
// via createCanonicalWorkflowVersion to append a new latest version).
export async function getCanonicalWorkflowVersion(
  workflowId: string,
  versionId: string,
  accessToken: string,
): Promise<CanonicalWorkflowVersionDetail> {
  const response = await trackedFetch(
    `${BASE}/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(versionId)}`,
    { headers: buildHeaders(accessToken) },
  );
  return parseJsonOrError<CanonicalWorkflowVersionDetail>(
    response,
    `Failed to load workflow version: ${response.status}`,
  );
}

// ---------------------------------------------------------------------------
// HEL-822 — Environments: deploy / rollback / restore (over the HEL-820 API)
// ---------------------------------------------------------------------------

export type WorkflowEnvironment = "dev" | "staging" | "prod";

export const WORKFLOW_ENVIRONMENTS: readonly WorkflowEnvironment[] = ["dev", "staging", "prod"];

export interface WorkflowDeployment {
  id: string;
  workflowId: string;
  environment: WorkflowEnvironment;
  versionId: string;
  version: number;
  note: string | null;
  createdAt: string;
  createdByUserId: string | null;
}

export interface WorkflowDeploymentsResponse {
  workflowId: string;
  deployments: WorkflowDeployment[];
  /** Current (most recent) deployment per environment, or null. */
  current: Record<WorkflowEnvironment, WorkflowDeployment | null>;
}

/** Deploy a version to an environment (atomic). */
export async function deployWorkflowVersion(
  workflowId: string,
  environment: WorkflowEnvironment,
  versionId: string,
  accessToken: string,
): Promise<WorkflowDeployment> {
  const response = await trackedFetch(
    `${BASE}/workflows/${encodeURIComponent(workflowId)}/deployments`,
    {
      method: "POST",
      headers: buildHeaders(accessToken, { "Content-Type": "application/json" }),
      body: JSON.stringify({ environment, versionId }),
    },
  );
  return parseJsonOrError<WorkflowDeployment>(
    response,
    `Failed to deploy version: ${response.status}`,
  );
}

/** Roll an environment back to an earlier version (a deploy with a note). */
export async function rollbackWorkflowVersion(
  workflowId: string,
  environment: WorkflowEnvironment,
  versionId: string,
  accessToken: string,
): Promise<WorkflowDeployment> {
  const response = await trackedFetch(
    `${BASE}/workflows/${encodeURIComponent(workflowId)}/deployments/rollback`,
    {
      method: "POST",
      headers: buildHeaders(accessToken, { "Content-Type": "application/json" }),
      body: JSON.stringify({ environment, versionId }),
    },
  );
  return parseJsonOrError<WorkflowDeployment>(
    response,
    `Failed to roll back version: ${response.status}`,
  );
}

/** Deployment history + the current deployment per environment. */
export async function listWorkflowDeployments(
  workflowId: string,
  accessToken: string,
  environment?: WorkflowEnvironment,
): Promise<WorkflowDeploymentsResponse> {
  const qs = environment ? `?environment=${encodeURIComponent(environment)}` : "";
  const response = await trackedFetch(
    `${BASE}/workflows/${encodeURIComponent(workflowId)}/deployments${qs}`,
    { headers: buildHeaders(accessToken) },
  );
  return parseJsonOrError<WorkflowDeploymentsResponse>(
    response,
    `Failed to list deployments: ${response.status}`,
  );
}

/** Atomic history-restore: append a new latest version holding the old dag. */
export async function restoreWorkflowVersion(
  workflowId: string,
  versionId: string,
  accessToken: string,
): Promise<CanonicalWorkflowVersionDetail & { restoredFromVersion: number }> {
  const response = await trackedFetch(
    `${BASE}/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(versionId)}/restore`,
    { method: "POST", headers: buildHeaders(accessToken) },
  );
  return parseJsonOrError<CanonicalWorkflowVersionDetail & { restoredFromVersion: number }>(
    response,
    `Failed to restore version: ${response.status}`,
  );
}

// ---------------------------------------------------------------------------
// HEL-241C — Presence (collaborative awareness)
// ---------------------------------------------------------------------------

export interface WorkflowPresenceCursor {
  x: number;
  y: number;
}

export interface WorkflowPresencePeer {
  userId: string;
  name: string;
  color: string;
  selectedStepId?: string | null;
  /** Live cursor in canvas coordinates. Null when off-canvas. */
  cursor?: WorkflowPresenceCursor | null;
  lastSeen: number;
}

export interface WorkflowPresenceResponse {
  peers: WorkflowPresencePeer[];
}

/**
 * Heartbeat the caller's presence and pull the current peer list in
 * one round-trip. Designed to be called on a 5s interval while the
 * Studio is open. The server reaps any peer that hasn't called within
 * the last PRESENCE_TTL_MS (30s), so closing the tab eventually
 * removes the user automatically — no explicit "leave" needed.
 */
export async function heartbeatWorkflowPresence(
  workflowId: string,
  input: {
    selectedStepId?: string | null;
    name?: string;
    cursor?: WorkflowPresenceCursor | null;
  },
  accessToken: string,
): Promise<WorkflowPresenceResponse> {
  const response = await trackedFetch(
    `${BASE}/workflows/${encodeURIComponent(workflowId)}/presence`,
    {
      method: "POST",
      headers: buildHeaders(accessToken, { "Content-Type": "application/json" }),
      body: JSON.stringify(input),
    },
  );
  return parseJsonOrError<WorkflowPresenceResponse>(
    response,
    `Failed to heartbeat presence: ${response.status}`,
  );
}

/**
 * Build the SSE URL for the live presence stream (HEL-241C v2).
 * EventSource can't set headers, so the access token rides on the
 * query string — the server promotes it into the Authorization header
 * via the promoteSseAccessToken shim in app.ts.
 */
export function workflowPresenceStreamUrl(
  workflowId: string,
  accessToken: string,
): string {
  const url = new URL(
    `${BASE}/workflows/${encodeURIComponent(workflowId)}/presence/stream`,
    typeof window === "undefined" ? "http://localhost" : window.location.origin,
  );
  url.searchParams.set("access_token", accessToken);
  return url.toString();
}

/**
 * Build the y-websocket server URL for workflow Y.Doc sync (HEL-241C-2b).
 *
 * y-websocket appends `/${roomName}` itself (the room is `${workflowId}/ydoc`),
 * so this returns the collection base with the scheme swapped for WebSocket
 * transport. The `access_token` + `workspaceId` query params come from
 * `useYDoc`, and both backends expect the same room + params:
 *
 *   - in-process API room (default): `${BASE}/workflows` → `/api/workflows/<id>/ydoc`
 *   - WorkflowDocDO host (HEL-803, when `VITE_WF_DOC_WS_ORIGIN` is set):
 *     `${workerOrigin}/workflows` → `<worker>/workflows/<id>/ydoc`
 *
 * So the cutover is purely this origin swap — the room name + auth params are
 * identical, and the DO's edge gate (HEL-801) reads the same `?access_token=`/
 * `?workspaceId=`.
 */
export function workflowYDocWebSocketUrl(): string {
  const workerOrigin = getWorkflowDocWorkerOrigin();
  const url = new URL(
    workerOrigin ? `${workerOrigin}/workflows` : `${BASE}/workflows`,
    typeof window === "undefined" ? "http://localhost" : window.location.origin,
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString().replace(/\/$/, "");
}
