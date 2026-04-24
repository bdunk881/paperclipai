import type { WorkflowTemplate, WorkflowRun, WorkflowStep } from "../types/workflow";
import { getApiBasePath } from "./baseUrl";
import { readStoredAuthUser } from "../auth/authStorage";

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

function buildAuthHeaders(accessToken?: string): HeadersInit | undefined {
  if (accessToken) {
    return { Authorization: `Bearer ${accessToken}` };
  }

  const storedUser = readStoredAuthUser();
  if (storedUser?.id) {
    return { "X-User-Id": storedUser.id };
  }

  return undefined;
}

function buildJsonHeaders(
  accessToken?: string,
  extras?: Record<string, string | undefined>
): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  } else {
    const storedUser = readStoredAuthUser();
    if (storedUser?.id) {
      headers["X-User-Id"] = storedUser.id;
    }
  }

  if (extras) {
    for (const [key, value] of Object.entries(extras)) {
      if (value) {
        headers[key] = value;
      }
    }
  }

  return headers;
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

// ---------------------------------------------------------------------------
// LLM Config API functions
// ---------------------------------------------------------------------------

/** GET /api/llm-configs */
export async function listLLMConfigs(accessToken: string): Promise<LLMConfig[]> {
  const res = await fetch(`${BASE}/llm-configs`, {
    headers: buildAuthHeaders(accessToken),
  });
  if (!res.ok) throw new Error(`Failed to fetch LLM configs: ${res.status}`);
  const data = await res.json();
  return data.configs as LLMConfig[];
}

/** POST /api/llm-configs */
export async function createLLMConfig(
  input: CreateLLMConfigInput,
  accessToken?: string
): Promise<LLMConfig> {
  const res = await fetch(`${BASE}/llm-configs`, {
    method: "POST",
    headers: buildJsonHeaders(accessToken),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? `Failed to create LLM config: ${res.status}`);
  }
  return res.json() as Promise<LLMConfig>;
}

/** PATCH /api/llm-configs/:id/default */
export async function setDefaultLLMConfig(id: string, accessToken?: string): Promise<LLMConfig> {
  const res = await fetch(`${BASE}/llm-configs/${encodeURIComponent(id)}/default`, {
    method: "PATCH",
    headers: buildAuthHeaders(accessToken),
  });
  if (!res.ok) throw new Error(`Failed to set default: ${res.status}`);
  return res.json() as Promise<LLMConfig>;
}

/** DELETE /api/llm-configs/:id */
export async function deleteLLMConfig(id: string, accessToken?: string): Promise<void> {
  const res = await fetch(`${BASE}/llm-configs/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: buildAuthHeaders(accessToken),
  });
  if (!res.ok) throw new Error(`Failed to delete LLM config: ${res.status}`);
}

const BASE = getApiBasePath();

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

export type ControlPlaneAgentLifecycleStatus = "active" | "paused" | "terminated";
export type ControlPlaneHeartbeatStatus = "queued" | "running" | "completed" | "blocked";
export type ControlPlaneTaskStatus = "todo" | "in_progress" | "done" | "blocked";
export type ControlPlaneTeamDeploymentMode = "workflow_runtime" | "continuous_agents";
export type ControlPlaneAgentScheduleType = "manual" | "interval" | "cron";

export interface ControlPlaneAgentSchedule {
  type: ControlPlaneAgentScheduleType;
  cronExpression?: string;
  intervalMinutes?: number;
}

export interface ControlPlaneAgent {
  id: string;
  teamId: string;
  userId: string;
  name: string;
  roleKey: string;
  workflowStepId?: string;
  workflowStepKind?: string;
  model?: string;
  instructions: string;
  budgetMonthlyUsd: number;
  reportingToAgentId?: string;
  schedule: ControlPlaneAgentSchedule;
  status: ControlPlaneAgentLifecycleStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ControlPlaneTeam {
  id: string;
  userId: string;
  name: string;
  description?: string;
  workflowTemplateId?: string;
  workflowTemplateName?: string;
  deploymentMode: ControlPlaneTeamDeploymentMode;
  budgetMonthlyUsd: number;
  orchestrationEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ControlPlaneTaskAuditEvent {
  id: string;
  type: "created" | "checked_out" | "status_changed";
  actor: string;
  detail: string;
  timestamp: string;
}

export interface ControlPlaneTask {
  id: string;
  teamId: string;
  userId: string;
  title: string;
  description?: string;
  sourceRunId?: string;
  sourceWorkflowStepId?: string;
  assignedAgentId?: string;
  checkedOutBy?: string;
  checkedOutAt?: string;
  status: ControlPlaneTaskStatus;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  auditTrail: ControlPlaneTaskAuditEvent[];
}

export interface ControlPlaneHeartbeatRecord {
  id: string;
  teamId: string;
  agentId: string;
  userId: string;
  status: ControlPlaneHeartbeatStatus;
  summary?: string;
  costUsd?: number;
  createdTaskIds: string[];
  startedAt: string;
  completedAt?: string;
}

export interface ControlPlaneDeployment {
  team: ControlPlaneTeam;
  agents: ControlPlaneAgent[];
  workflow: Pick<WorkflowTemplate, "id" | "name" | "category" | "version">;
}

export interface ControlPlaneTeamDetail {
  team: ControlPlaneTeam;
  agents: ControlPlaneAgent[];
  tasks: ControlPlaneTask[];
  heartbeats: ControlPlaneHeartbeatRecord[];
}

export interface DeployWorkflowAsTeamInput {
  templateId: string;
  teamName?: string;
  budgetMonthlyUsd?: number;
  defaultIntervalMinutes?: number;
}

type CreateTemplateInput = Omit<WorkflowTemplate, "id"> & { id?: string };

/** GET /api/templates */
export async function listTemplates(category?: string): Promise<TemplateSummary[]> {
  const url = category ? `${BASE}/templates?category=${encodeURIComponent(category)}` : `${BASE}/templates`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch templates: ${res.status}`);
  const data = await res.json();
  return data.templates as TemplateSummary[];
}

/** POST /api/templates */
export async function createTemplate(input: CreateTemplateInput): Promise<WorkflowTemplate> {
  const res = await fetch(`${BASE}/templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? `Failed to save template: ${res.status}`);
  }
  return res.json() as Promise<WorkflowTemplate>;
}

/** GET /api/templates/:id */
export async function getTemplate(id: string): Promise<WorkflowTemplate> {
  const res = await fetch(`${BASE}/templates/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Template not found: ${id}`);
  return res.json() as Promise<WorkflowTemplate>;
}

/** GET /api/runs */
export async function listRuns(templateId?: string, accessToken?: string): Promise<WorkflowRun[]> {
  const url = templateId
    ? `${BASE}/runs?templateId=${encodeURIComponent(templateId)}`
    : `${BASE}/runs`;
  const res = await fetch(url, {
    headers: buildAuthHeaders(accessToken),
  });
  if (!res.ok) throw new Error(await readApiError(res, `Failed to fetch runs: ${res.status}`));
  const data = await res.json();
  return data.runs as WorkflowRun[];
}

/** GET /api/runs/:id */
export async function getRun(id: string, accessToken?: string): Promise<WorkflowRun> {
  const res = await fetch(`${BASE}/runs/${encodeURIComponent(id)}`, {
    headers: buildAuthHeaders(accessToken),
  });
  if (!res.ok) throw new Error(`Run not found: ${id}`);
  return res.json() as Promise<WorkflowRun>;
}

/** GET /api/control-plane/teams */
export async function listControlPlaneTeams(accessToken?: string): Promise<ControlPlaneTeam[]> {
  const res = await fetch(`${BASE}/control-plane/teams`, {
    headers: buildAuthHeaders(accessToken),
  });
  if (!res.ok) throw new Error(await readApiError(res, `Failed to fetch deployed teams: ${res.status}`));
  const data = await res.json();
  return data.teams as ControlPlaneTeam[];
}

/** GET /api/control-plane/teams/:id */
export async function getControlPlaneTeam(
  teamId: string,
  accessToken?: string
): Promise<ControlPlaneTeamDetail> {
  const res = await fetch(`${BASE}/control-plane/teams/${encodeURIComponent(teamId)}`, {
    headers: buildAuthHeaders(accessToken),
  });
  if (!res.ok) throw new Error(await readApiError(res, `Failed to fetch deployed team: ${res.status}`));
  return res.json() as Promise<ControlPlaneTeamDetail>;
}

/** POST /api/control-plane/deployments/workflow */
export async function deployWorkflowAsTeam(
  input: DeployWorkflowAsTeamInput,
  accessToken?: string,
  runId = globalThis.crypto?.randomUUID?.() ?? `control-plane-${Date.now()}`
): Promise<ControlPlaneDeployment> {
  const res = await fetch(`${BASE}/control-plane/deployments/workflow`, {
    method: "POST",
    headers: buildJsonHeaders(accessToken, {
      "X-Paperclip-Run-Id": runId,
    }),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? `Failed to deploy workflow as team: ${res.status}`);
  }
  return res.json() as Promise<ControlPlaneDeployment>;
}

/** POST /api/runs */
export async function startRun(
  templateId: string,
  input: Record<string, unknown>,
  config?: Record<string, unknown>,
  accessToken?: string
): Promise<WorkflowRun> {
  const res = await fetch(`${BASE}/runs`, {
    method: "POST",
    headers: buildJsonHeaders(accessToken),
    body: JSON.stringify({ templateId, input, config }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? `Failed to start run: ${res.status}`);
  }
  return res.json() as Promise<WorkflowRun>;
}

/** POST /api/workflows/generate — NL description → workflow steps */
export async function generateWorkflow(
  description: string,
  llmConfigId?: string,
  accessToken?: string
): Promise<WorkflowStep[]> {
  const res = await fetch(`${BASE}/workflows/generate`, {
    method: "POST",
    headers: buildJsonHeaders(accessToken),
    body: JSON.stringify({ description, llmConfigId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? `Generation failed: ${res.status}`);
  }
  const data = await res.json();
  return data.steps as WorkflowStep[];
}

/**
 * POST /api/runs/file — start a file-triggered run via multipart upload.
 * @param templateId  The workflow template to execute.
 * @param file        The File object from a file input or drop event.
 * @param userId      Optional user identifier forwarded as X-User-Id.
 */
export async function startRunWithFile(
  templateId: string,
  file: File,
  userId?: string,
  accessToken?: string
): Promise<WorkflowRun> {
  const form = new FormData();
  form.append("templateId", templateId);
  form.append("file", file);

  const headers: Record<string, string> = {};
  if (userId) headers["X-User-Id"] = userId;
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE}/runs/file`, { method: "POST", headers, body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? `Failed to start file run: ${res.status}`);
  }
  return res.json() as Promise<WorkflowRun>;
}

/** POST /api/debug/step — AI debugger for failed steps */
export async function debugStep(
  stepId: string,
  error: string,
  output: Record<string, unknown>
): Promise<{ explanation: string; suggestion: string }> {
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

// ---------------------------------------------------------------------------
// Proposal Builder API
// ---------------------------------------------------------------------------

export interface ProposalCrmRecord {
  id: string;
  accountName: string;
  contactName: string;
  contactEmail: string;
  dealValue: number;
  stage: string;
  owner: string;
  updatedAt: string;
}

export interface ProposalTemplateOption {
  id: string;
  name: string;
  description: string;
  focus: string;
}

export interface ProposalHistoryItem {
  id: string;
  accountName: string;
  status: "Draft" | "Sent" | "Exported";
  format: "PDF" | "DOCX";
  exportedAt: string;
}

export interface ProposalUsageSummary {
  used: number;
  limit: number;
}

export interface ProposalDraftResult {
  title: string;
  body: string;
  variableHints: string[];
}

export interface ProposalContextResponse {
  records: ProposalCrmRecord[];
  templates: ProposalTemplateOption[];
  history: ProposalHistoryItem[];
  usage: ProposalUsageSummary;
}

export interface CreateProposalRequest {
  crmRecordIds: string[];
  templateId: string;
}

export interface CreateProposalResponse {
  jobId: string;
  status: "queued" | "processing";
  pollUrl?: string;
}

export interface ProposalJobStatusResponse {
  jobId: string;
  status: "queued" | "processing" | "completed" | "failed";
  draft?: ProposalDraftResult;
  events: string[];
  usage?: ProposalUsageSummary;
}

const PROPOSAL_CONTEXT_FALLBACK: ProposalContextResponse = {
  records: [
    {
      id: "crm-001",
      accountName: "Northwind Logistics",
      contactName: "Jordan Lee",
      contactEmail: "jordan@northwind.example",
      dealValue: 125000,
      stage: "Negotiation",
      owner: "R. Bennett",
      updatedAt: "2026-04-18T14:10:00.000Z",
    },
    {
      id: "crm-002",
      accountName: "Summit BioSystems",
      contactName: "Amaya Patel",
      contactEmail: "amaya@summit.example",
      dealValue: 78000,
      stage: "Proposal Requested",
      owner: "D. Kim",
      updatedAt: "2026-04-18T16:35:00.000Z",
    },
    {
      id: "crm-003",
      accountName: "Atlas Retail Group",
      contactName: "Chris Romero",
      contactEmail: "chris@atlas.example",
      dealValue: 212000,
      stage: "Discovery",
      owner: "S. Flores",
      updatedAt: "2026-04-18T19:03:00.000Z",
    },
  ],
  templates: [
    {
      id: "tpl-enterprise-modern",
      name: "Enterprise Modern",
      description: "Executive summary and phased delivery model.",
      focus: "Enterprise rollout",
    },
    {
      id: "tpl-growth-velocity",
      name: "Growth Velocity",
      description: "Outcome-led narrative built around measurable upside.",
      focus: "Revenue acceleration",
    },
    {
      id: "tpl-technical-deep-dive",
      name: "Technical Deep Dive",
      description: "Security, architecture, and integration-heavy proposal framing.",
      focus: "Technical buyers",
    },
  ],
  history: [
    {
      id: "proposal-882",
      accountName: "Aster Cloud",
      status: "Exported",
      format: "PDF",
      exportedAt: "2026-04-15T13:10:00.000Z",
    },
    {
      id: "proposal-881",
      accountName: "Falcon Finance",
      status: "Sent",
      format: "DOCX",
      exportedAt: "2026-04-14T10:22:00.000Z",
    },
    {
      id: "proposal-880",
      accountName: "Pioneer Health",
      status: "Draft",
      format: "PDF",
      exportedAt: "2026-04-13T17:45:00.000Z",
    },
  ],
  usage: { used: 4, limit: 5 },
};

const PROPOSAL_JOB_FALLBACK: ProposalJobStatusResponse = {
  jobId: "mock-proposal-job",
  status: "completed",
  events: [
    "CRM context validated",
    "Proposal brief generated",
    "Draft sections assembled",
    "Formatting pass complete",
  ],
  draft: {
    title: "AutoFlow Proposal Draft",
    body:
      "# Executive Summary\n\nAutoFlow can reduce manual proposal prep by 70%.\n\n## Solution Outline\n\n- CRM context ingestion\n- AI-assisted draft generation\n- Team review and export\n\n## Commercial Terms\n\nEstimated annual value: {{DealValue}}",
    variableHints: ["{{ClientName}}", "{{DealValue}}", "{{OwnerName}}"],
  },
  usage: { used: 5, limit: 5 },
};

export async function listProposalContext(accessToken?: string): Promise<ProposalContextResponse> {
  const res = await fetch(`${BASE}/proposals/context`, {
    headers: buildAuthHeaders(accessToken),
  });
  if (res.status === 404) {
    return PROPOSAL_CONTEXT_FALLBACK;
  }
  if (!res.ok) throw new Error(`Failed to fetch proposal context: ${res.status}`);
  const data = await res.json();
  return {
    records: (data.records ?? PROPOSAL_CONTEXT_FALLBACK.records) as ProposalCrmRecord[],
    templates: (data.templates ?? PROPOSAL_CONTEXT_FALLBACK.templates) as ProposalTemplateOption[],
    history: (data.history ?? PROPOSAL_CONTEXT_FALLBACK.history) as ProposalHistoryItem[],
    usage: (data.usage ?? PROPOSAL_CONTEXT_FALLBACK.usage) as ProposalUsageSummary,
  };
}

export async function createProposalDraft(
  input: CreateProposalRequest,
  accessToken: string
): Promise<CreateProposalResponse> {
  const res = await fetch(`${BASE}/proposals`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(accessToken),
    },
    body: JSON.stringify(input),
  });
  if (res.status === 404) {
    return { jobId: PROPOSAL_JOB_FALLBACK.jobId, status: "queued" };
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? `Failed to create proposal draft: ${res.status}`);
  }
  return res.json() as Promise<CreateProposalResponse>;
}

export async function getProposalJobStatus(
  jobId: string,
  accessToken: string
): Promise<ProposalJobStatusResponse> {
  const res = await fetch(`${BASE}/proposals/${encodeURIComponent(jobId)}`, {
    headers: buildAuthHeaders(accessToken),
  });
  if (res.status === 404) {
    return { ...PROPOSAL_JOB_FALLBACK, jobId };
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? `Failed to fetch proposal job status: ${res.status}`);
  }
  return res.json() as Promise<ProposalJobStatusResponse>;
}

// ---------------------------------------------------------------------------
// Memory API — persistent context memory store
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  id: string;
  userId: string;
  workflowId?: string;
  workflowName?: string;
  agentId?: string;
  key: string;
  text: string;
  ttlSeconds?: number;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
}

export interface MemoryStats {
  totalEntries: number;
  totalBytes: number;
  workflowCount: number;
}

export interface WriteMemoryInput {
  key: string;
  text: string;
  workflowId?: string;
  workflowName?: string;
  agentId?: string;
  ttlSeconds?: number;
}

function getMemoryHeaders(accessToken: string, userId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };
  if (userId) headers["X-User-Id"] = userId;
  return headers;
}

/** GET /api/memory — list all entries for the current user */
export async function listMemoryEntries(
  accessToken: string,
  userId?: string,
  workflowId?: string
): Promise<MemoryEntry[]> {
  const url = workflowId
    ? `${BASE}/memory?workflowId=${encodeURIComponent(workflowId)}`
    : `${BASE}/memory`;
  const res = await fetch(url, { headers: getMemoryHeaders(accessToken, userId) });
  if (!res.ok) throw new Error(`Failed to fetch memory entries: ${res.status}`);
  const data = await res.json();
  return data.entries as MemoryEntry[];
}

/** GET /api/memory/search — keyword/semantic search */
export async function searchMemory(
  query: string,
  accessToken: string,
  userId?: string,
  agentId?: string
): Promise<MemorySearchResult[]> {
  const params = new URLSearchParams({ q: query });
  if (agentId) params.set("agentId", agentId);
  const res = await fetch(`${BASE}/memory/search?${params.toString()}`, {
    headers: getMemoryHeaders(accessToken, userId),
  });
  if (!res.ok) throw new Error(`Memory search failed: ${res.status}`);
  const data = await res.json();
  return data.results as MemorySearchResult[];
}

/** POST /api/memory — write (create or upsert) a memory entry */
export async function writeMemoryEntry(
  input: WriteMemoryInput,
  accessToken: string,
  userId?: string
): Promise<MemoryEntry> {
  const res = await fetch(`${BASE}/memory`, {
    method: "POST",
    headers: getMemoryHeaders(accessToken, userId),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? `Failed to write memory: ${res.status}`);
  }
  return res.json() as Promise<MemoryEntry>;
}

/** DELETE /api/memory/:id — delete a single entry */
export async function deleteMemoryEntry(id: string, accessToken: string, userId?: string): Promise<void> {
  const res = await fetch(`${BASE}/memory/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: getMemoryHeaders(accessToken, userId),
  });
  if (!res.ok && res.status !== 404) throw new Error(`Failed to delete memory entry: ${res.status}`);
}

/** GET /api/memory/stats — usage stats */
export async function getMemoryStats(accessToken: string, userId?: string): Promise<MemoryStats> {
  const res = await fetch(`${BASE}/memory/stats`, { headers: getMemoryHeaders(accessToken, userId) });
  if (!res.ok) throw new Error(`Failed to fetch memory stats: ${res.status}`);
  return res.json() as Promise<MemoryStats>;
}

// ---------------------------------------------------------------------------
// Approvals API — HITL approval inbox
// ---------------------------------------------------------------------------

export interface ApprovalRequest {
  id: string;
  runId: string;
  templateName: string;
  stepId: string;
  stepName: string;
  assignee: string;
  message: string;
  timeoutMinutes: number;
  requestedAt: string;
  status: "pending" | "approved" | "rejected" | "timed_out";
  resolvedAt?: string;
  comment?: string;
}

/** GET /api/approvals */
export async function listApprovals(
  accessToken: string,
  status?: "pending" | "approved" | "rejected" | "timed_out"
): Promise<ApprovalRequest[]> {
  const url = status
    ? `${BASE}/approvals?status=${encodeURIComponent(status)}`
    : `${BASE}/approvals`;
  const res = await fetch(url, { headers: buildAuthHeaders(accessToken) });
  if (!res.ok) throw new Error(`Failed to fetch approvals: ${res.status}`);
  const data = await res.json();
  return data.approvals as ApprovalRequest[];
}

/** POST /api/approvals/:id/resolve */
export async function resolveApproval(
  id: string,
  decision: "approved" | "rejected",
  accessToken: string,
  comment?: string
): Promise<void> {
  const res = await fetch(`${BASE}/approvals/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...buildAuthHeaders(accessToken) },
    body: JSON.stringify({ decision, comment }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? `Failed to resolve approval: ${res.status}`);
  }
}
