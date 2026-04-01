import type { WorkflowTemplate, WorkflowRun } from "../types/workflow";
import { MOCK_TEMPLATES, MOCK_RUNS, generateRunId } from "../data/mockData";

// ---------------------------------------------------------------------------
// LLM Config types — mirrors src/engine/llmProviders/types.ts
// ---------------------------------------------------------------------------

export type ProviderName = "openai" | "anthropic" | "gemini" | "mistral";

/** Available models per provider — mirrors PROVIDER_MODELS from the backend */
export const PROVIDER_MODELS: Record<ProviderName, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  anthropic: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  gemini: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
  mistral: ["mistral-large-latest", "mistral-small-latest", "open-mistral-7b"],
};

/** A saved LLM provider config (API key stored server-side, never returned) */
export interface LLMConfig {
  id: string;
  label: string;
  provider: ProviderName;
  model: string;
  isDefault: boolean;
  maskedApiKey: string; // e.g. "sk-...x7k3"
  createdAt: string;
}

export interface CreateLLMConfigInput {
  label: string;
  provider: ProviderName;
  model: string;
  apiKey: string;
}

// ---------------------------------------------------------------------------
// LLM Config API functions
// ---------------------------------------------------------------------------

/** GET /api/llm-configs */
export async function listLLMConfigs(): Promise<LLMConfig[]> {
  const res = await fetch(`${BASE}/llm-configs`);
  if (!res.ok) throw new Error(`Failed to fetch LLM configs: ${res.status}`);
  const data = await res.json();
  return data.configs as LLMConfig[];
}

/** POST /api/llm-configs */
export async function createLLMConfig(input: CreateLLMConfigInput): Promise<LLMConfig> {
  const res = await fetch(`${BASE}/llm-configs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? `Failed to create LLM config: ${res.status}`);
  }
  return res.json() as Promise<LLMConfig>;
}

/** PATCH /api/llm-configs/:id/default */
export async function setDefaultLLMConfig(id: string): Promise<LLMConfig> {
  const res = await fetch(`${BASE}/llm-configs/${encodeURIComponent(id)}/default`, {
    method: "PATCH",
  });
  if (!res.ok) throw new Error(`Failed to set default: ${res.status}`);
  return res.json() as Promise<LLMConfig>;
}

/** DELETE /api/llm-configs/:id */
export async function deleteLLMConfig(id: string): Promise<void> {
  const res = await fetch(`${BASE}/llm-configs/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete LLM config: ${res.status}`);
}

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
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? `Failed to start run: ${res.status}`);
  }
  return res.json() as Promise<WorkflowRun>;
}

/** POST /api/debug/step — AI debugger for failed steps */
export async function debugStep(
  stepId: string,
  error: string,
  output: Record<string, unknown>
): Promise<{ explanation: string; suggestion: string }> {
  if (USE_MOCK) {
    await delay(1200);
    return {
      explanation:
        "The step failed because the input data was missing the required field \"email\". The LLM provider returned a validation error after the template variable could not be resolved.",
      suggestion:
        "Check that the upstream trigger step is passing an \"email\" key in its output. Update the Input Keys for this step to include \"email\" and verify the trigger payload includes it.",
    };
  }
  const res = await fetch(`${BASE}/debug/step`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stepId, error, output }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? `Debug request failed: ${res.status}`);
  }
  return res.json() as Promise<{ explanation: string; suggestion: string }>;
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
