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

import { getApiBasePath } from "./baseUrl";
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
): Promise<CanonicalWorkflow[]> {
  const response = await trackedFetch(`${BASE}/workflows`, {
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
