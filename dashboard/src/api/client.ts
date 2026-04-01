import type { WorkflowTemplate, WorkflowRun } from "../types/workflow";
import { MOCK_TEMPLATES, MOCK_RUNS, generateRunId } from "../data/mockData";

const BASE = "/api";
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";

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
  if (USE_MOCK) {
    await delay(150);
    const filtered = category ? MOCK_TEMPLATES.filter((t) => t.category === category) : MOCK_TEMPLATES;
    return filtered.map(toSummary);
  }
  const url = category ? `${BASE}/templates?category=${encodeURIComponent(category)}` : `${BASE}/templates`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch templates: ${res.status}`);
  const data = await res.json();
  return data.templates as TemplateSummary[];
}

/** GET /api/templates/:id */
export async function getTemplate(id: string): Promise<WorkflowTemplate> {
  if (USE_MOCK) {
    await delay(100);
    const tpl = MOCK_TEMPLATES.find((t) => t.id === id);
    if (!tpl) throw new Error(`Template not found: ${id}`);
    return tpl;
  }
  const res = await fetch(`${BASE}/templates/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Template not found: ${id}`);
  return res.json() as Promise<WorkflowTemplate>;
}

/** GET /api/runs */
export async function listRuns(templateId?: string): Promise<WorkflowRun[]> {
  if (USE_MOCK) {
    await delay(200);
    return templateId ? MOCK_RUNS.filter((r) => r.templateId === templateId) : [...MOCK_RUNS];
  }
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
  if (USE_MOCK) {
    await delay(100);
    const run = MOCK_RUNS.find((r) => r.id === id);
    if (!run) throw new Error(`Run not found: ${id}`);
    return run;
  }
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
  if (USE_MOCK) {
    await delay(600);
    const tpl = MOCK_TEMPLATES.find((t) => t.id === templateId);
    const newRun: WorkflowRun = {
      id: generateRunId(),
      templateId,
      templateName: tpl?.name ?? templateId,
      status: "running",
      startedAt: new Date().toISOString(),
      input,
      stepResults: tpl?.steps.slice(0, 1).map((s) => ({
        stepId: s.id,
        stepName: s.name,
        status: "running",
        output: {},
        durationMs: 0,
      })) ?? [],
    };
    MOCK_RUNS.unshift(newRun);
    return newRun;
  }
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

// --- helpers ---

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function toSummary(t: WorkflowTemplate): TemplateSummary {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    version: t.version,
    stepCount: t.steps.length,
    configFieldCount: t.configFields.length,
  };
}
