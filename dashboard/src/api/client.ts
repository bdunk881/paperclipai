import type { WorkflowTemplate, WorkflowRun } from "../types/workflow";

const BASE = "/api";

/** Template summary returned by GET /api/templates (list) */
export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  category: WorkflowTemplate["category"];
  version: string;
  stepCount: number;
  configFieldCount: number;
}

/** GET /api/templates */
export async function listTemplates(category?: string): Promise<TemplateSummary[]> {
  const url = category ? `${BASE}/templates?category=${encodeURIComponent(category)}` : `${BASE}/templates`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch templates: ${res.status}`);
  const data = await res.json();
  return data.templates as TemplateSummary[];
}

/** GET /api/templates/:id */
export async function getTemplate(id: string): Promise<WorkflowTemplate> {
  const res = await fetch(`${BASE}/templates/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Template not found: ${id}`);
  return res.json() as Promise<WorkflowTemplate>;
}

/** GET /api/runs */
export async function listRuns(templateId?: string): Promise<WorkflowRun[]> {
  const url = templateId
    ? `${BASE}/runs?templateId=${encodeURIComponent(templateId)}`
    : `${BASE}/runs`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch runs: ${res.status}`);
  const data = await res.json();
  return data.runs as WorkflowRun[];
}

/** GET /api/runs/:id */
export async function getRun(id: string): Promise<WorkflowRun> {
  const res = await fetch(`${BASE}/runs/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Run not found: ${id}`);
  return res.json() as Promise<WorkflowRun>;
}

/** POST /api/runs */
export async function startRun(
  templateId: string,
  input: Record<string, unknown>,
  config?: Record<string, unknown>
): Promise<WorkflowRun> {
  const res = await fetch(`${BASE}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateId, input, config }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `Failed to start run: ${res.status}`);
  }
  return res.json() as Promise<WorkflowRun>;
}
