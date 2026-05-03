import type { WorkflowTemplate, WorkflowRun, WorkflowStep } from "../types/workflow";
import { getApiBasePath } from "./baseUrl";
import { readStoredAuthUser } from "../auth/authStorage";
import { trackedFetch } from "./trackedFetch";
import {
  createMockTemplate,
  getMockRun,
  getMockTemplate,
  listMockLLMConfigs,
  listMockRuns,
  listMockTemplates,
  startMockRun,
} from "./mockWorkflowData";

// ---------------------------------------------------------------------------
// LLM Config types — mirrors src/engine/llmProviders/types.ts
// ---------------------------------------------------------------------------

export type ProviderName =
  | "openai"
  | "anthropic"
  | "gemini"
  | "mistral"
  | "azure-openai"
  | "groq"
  | "fireworks"
  | "together"
  | "ollama"
  | "localai"
  | "cohere"
  | "perplexity"
  | "xai"
  | "deepseek"
  | "bedrock"
  | "vertex-ai";

/** Available models per provider — mirrors PROVIDER_MODELS from the backend */
export const PROVIDER_MODELS: Record<ProviderName, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  anthropic: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  gemini: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
  mistral: ["mistral-large-latest", "mistral-small-latest", "open-mistral-7b"],
  "azure-openai": ["gpt-4o", "gpt-4o-mini", "gpt-4.1"],
  groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
  fireworks: [
    "accounts/fireworks/models/llama-v3p1-8b-instruct",
    "accounts/fireworks/models/llama-v3p1-70b-instruct",
    "accounts/fireworks/models/mixtral-8x7b-instruct",
  ],
  together: [
    "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
    "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
    "mistralai/Mixtral-8x7B-Instruct-v0.1",
  ],
  ollama: ["llama3.1:8b", "llama3.1:70b", "mixtral:8x7b"],
  localai: ["llama-3.1-8b-instruct", "llama-3.1-70b-instruct", "mixtral-8x7b-instruct"],
  cohere: ["command-r", "command-r-plus", "command-a-03-2025"],
  perplexity: ["sonar", "sonar-pro", "llama-3.1-sonar-large-128k-online"],
  xai: ["grok-2-1212", "grok-2-vision-1212", "grok-beta"],
  deepseek: ["deepseek-chat", "deepseek-reasoner", "deepseek-coder"],
  bedrock: [
    "anthropic.claude-3-5-sonnet-20241022-v2:0",
    "meta.llama3-1-70b-instruct-v1:0",
    "amazon.nova-pro-v1:0",
  ],
  "vertex-ai": ["gemini-2.0-flash-001", "gemini-1.5-pro-002", "claude-3-5-sonnet-v2@20241022"],
};

/** A saved LLM provider config (API key stored server-side, never returned) */
export interface LLMConfig {
  id: string;
  label: string;
  provider: ProviderName;
  model: string;
  isDefault: boolean;
  apiKeyMasked: string; // e.g. "****x7k3"
  createdAt: string;
}

export interface CreateLLMConfigInput {
  label: string;
  provider: ProviderName;
  model: string;
  apiKey: string;
}

export type ConnectorHealthState =
  | "healthy"
  | "degraded"
  | "rate_limited"
  | "auth_failed"
  | "provider_error"
  | "disabled";

export interface ConnectorHealthTransition {
  at: string;
  from: ConnectorHealthState;
  to: ConnectorHealthState;
  reason: string;
}

export interface ConnectorHealthRecord {
  connectorKey: string;
  connectorName: string;
  state: ConnectorHealthState;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  successRate24h: number;
  authFailures15m: number;
  rateLimitEvents15m: number;
  transitions: ConnectorHealthTransition[];
  source?: "mock" | "api";
}

export interface ConnectorHealthSummary {
  total: number;
  states: Record<ConnectorHealthState, number>;
  lastUpdatedAt: string;
  alertPolicy: {
    degradedWithinMinutes: number;
    authFailureThreshold15m: number;
    rateLimitThreshold15m: number;
    outageThresholdMinutes: number;
  };
  source?: "mock" | "api";
}

const USE_MOCK_API = import.meta.env.VITE_USE_MOCK === "true";

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

async function parseJsonOrError<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    throw new Error(await readApiError(response, fallback));
  }
  return response.json() as Promise<T>;
}

async function withMockApi<T>(remote: () => Promise<T>, local: () => T | Promise<T>): Promise<T> {
  if (USE_MOCK_API) {
    return await local();
  }
  return await remote();
}

export type ObservabilityEventCategory = "issue" | "run" | "heartbeat" | "budget" | "alert";

export interface ObservabilityEvent {
  id: string;
  sequence: string;
  userId: string;
  category: ObservabilityEventCategory;
  type: string;
  actor: {
    type: "agent" | "user" | "system" | "run";
    id: string;
    label?: string;
  };
  subject: {
    type: "team" | "agent" | "task" | "execution" | "ticket" | "workspace";
    id: string;
    label?: string;
    parentType?: "team" | "agent" | "task" | "execution" | "ticket" | "workspace";
    parentId?: string;
  };
  summary: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface ObservabilityFeedPage {
  events: ObservabilityEvent[];
  nextCursor: string | null;
  hasMore: boolean;
  generatedAt: string;
}

export interface ObservabilityThroughputSnapshot {
  windowHours: number;
  generatedAt: string;
  summary: {
    createdCount: number;
    completedCount: number;
    blockedCount: number;
    completionRate: number;
  };
  buckets: Array<{
    bucketStart: string;
    createdCount: number;
    completedCount: number;
    blockedCount: number;
  }>;
}

// ---------------------------------------------------------------------------
// LLM Config API functions
// ---------------------------------------------------------------------------

/** GET /api/llm-configs */
export async function listLLMConfigs(accessToken: string): Promise<LLMConfig[]> {
  return withMockApi(
    async () => {
      const res = await trackedFetch(`${BASE}/llm-configs`, {
        headers: buildAuthHeaders(accessToken),
      });
      if (!res.ok) throw new Error(`Failed to fetch LLM configs: ${res.status}`);
      const data = await res.json();
      return data.configs as LLMConfig[];
    },
    () => listMockLLMConfigs()
  );
}

/** POST /api/llm-configs */
export async function createLLMConfig(
  input: CreateLLMConfigInput,
  accessToken?: string
): Promise<LLMConfig> {
  const res = await trackedFetch(`${BASE}/llm-configs`, {
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
  const res = await trackedFetch(`${BASE}/llm-configs/${encodeURIComponent(id)}/default`, {
    method: "PATCH",
    headers: buildAuthHeaders(accessToken),
  });
  if (!res.ok) throw new Error(`Failed to set default: ${res.status}`);
  return res.json() as Promise<LLMConfig>;
}

/** DELETE /api/llm-configs/:id */
export async function deleteLLMConfig(id: string, accessToken?: string): Promise<void> {
  const res = await trackedFetch(`${BASE}/llm-configs/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: buildAuthHeaders(accessToken),
  });
  if (!res.ok) throw new Error(`Failed to delete LLM config: ${res.status}`);
}

const BASE = getApiBasePath();

const MOCK_CONNECTOR_HEALTH: ConnectorHealthRecord[] = [
  {
    connectorKey: "slack",
    connectorName: "Slack",
    state: "healthy",
    lastSuccessAt: "2026-04-28T04:35:00.000Z",
    lastErrorAt: null,
    lastErrorMessage: null,
    successRate24h: 99.8,
    authFailures15m: 0,
    rateLimitEvents15m: 0,
    transitions: [
      {
        at: "2026-04-28T02:10:00.000Z",
        from: "degraded",
        to: "healthy",
        reason: "API latency recovered below threshold",
      },
    ],
    source: "mock",
  },
  {
    connectorKey: "hubspot",
    connectorName: "HubSpot",
    state: "degraded",
    lastSuccessAt: "2026-04-28T04:31:00.000Z",
    lastErrorAt: "2026-04-28T04:33:00.000Z",
    lastErrorMessage: "Elevated 5xx responses from provider API",
    successRate24h: 94.3,
    authFailures15m: 0,
    rateLimitEvents15m: 1,
    transitions: [
      {
        at: "2026-04-28T04:20:00.000Z",
        from: "healthy",
        to: "degraded",
        reason: "Connector-wide provider failures crossed threshold",
      },
    ],
    source: "mock",
  },
  {
    connectorKey: "stripe",
    connectorName: "Stripe",
    state: "healthy",
    lastSuccessAt: "2026-04-28T04:34:00.000Z",
    lastErrorAt: "2026-04-28T01:11:00.000Z",
    lastErrorMessage: "Transient timeout retried successfully",
    successRate24h: 99.5,
    authFailures15m: 0,
    rateLimitEvents15m: 0,
    transitions: [],
    source: "mock",
  },
  {
    connectorKey: "gmail",
    connectorName: "Gmail",
    state: "rate_limited",
    lastSuccessAt: "2026-04-28T04:32:00.000Z",
    lastErrorAt: "2026-04-28T04:34:00.000Z",
    lastErrorMessage: "429 rate limit window active for sync jobs",
    successRate24h: 92.9,
    authFailures15m: 0,
    rateLimitEvents15m: 8,
    transitions: [],
    source: "mock",
  },
  {
    connectorKey: "sentry",
    connectorName: "Sentry",
    state: "healthy",
    lastSuccessAt: "2026-04-28T04:30:00.000Z",
    lastErrorAt: null,
    lastErrorMessage: null,
    successRate24h: 99.9,
    authFailures15m: 0,
    rateLimitEvents15m: 0,
    transitions: [],
    source: "mock",
  },
  {
    connectorKey: "linear",
    connectorName: "Linear",
    state: "auth_failed",
    lastSuccessAt: "2026-04-28T03:58:00.000Z",
    lastErrorAt: "2026-04-28T04:34:00.000Z",
    lastErrorMessage: "OAuth refresh token rejected by provider",
    successRate24h: 88.1,
    authFailures15m: 6,
    rateLimitEvents15m: 0,
    transitions: [],
    source: "mock",
  },
  {
    connectorKey: "teams",
    connectorName: "Teams",
    state: "healthy",
    lastSuccessAt: "2026-04-28T04:35:00.000Z",
    lastErrorAt: "2026-04-27T22:42:00.000Z",
    lastErrorMessage: "Webhook delivery delay recovered",
    successRate24h: 98.7,
    authFailures15m: 0,
    rateLimitEvents15m: 0,
    transitions: [],
    source: "mock",
  },
  {
    connectorKey: "jira",
    connectorName: "Jira",
    state: "provider_error",
    lastSuccessAt: "2026-04-28T02:48:00.000Z",
    lastErrorAt: "2026-04-28T04:35:00.000Z",
    lastErrorMessage: "Connector worker has not completed a successful sync in 90 minutes",
    successRate24h: 76.4,
    authFailures15m: 0,
    rateLimitEvents15m: 0,
    transitions: [],
    source: "mock",
  },
];

function summarizeConnectorHealth(connectors: ConnectorHealthRecord[]): ConnectorHealthSummary {
  return {
    total: connectors.length,
    states: {
      healthy: connectors.filter((c) => c.state === "healthy").length,
      degraded: connectors.filter((c) => c.state === "degraded").length,
      rate_limited: connectors.filter((c) => c.state === "rate_limited").length,
      auth_failed: connectors.filter((c) => c.state === "auth_failed").length,
      provider_error: connectors.filter((c) => c.state === "provider_error").length,
      disabled: connectors.filter((c) => c.state === "disabled").length,
    },
    lastUpdatedAt: "2026-04-28T04:35:00.000Z",
    alertPolicy: {
      degradedWithinMinutes: 5,
      authFailureThreshold15m: 5,
      rateLimitThreshold15m: 5,
      outageThresholdMinutes: 15,
    },
    source: "mock",
  };
}

export function getObservabilityStreamPath(params?: {
  after?: string;
  categories?: ObservabilityEventCategory[];
  limit?: number;
}): string {
  const search = new URLSearchParams();
  if (params?.after) {
    search.set("after", params.after);
  }
  if (params?.categories?.length) {
    search.set("categories", params.categories.join(","));
  }
  if (typeof params?.limit === "number") {
    search.set("limit", String(params.limit));
  }

  const query = search.toString();
  return `${BASE}/observability/events/stream${query ? `?${query}` : ""}`;
}

export async function listObservabilityEvents(
  input: {
    after?: string;
    categories?: ObservabilityEventCategory[];
    limit?: number;
  } = {},
  accessToken?: string
): Promise<ObservabilityFeedPage> {
  const search = new URLSearchParams();
  if (input.after) {
    search.set("after", input.after);
  }
  if (input.categories?.length) {
    search.set("categories", input.categories.join(","));
  }
  if (typeof input.limit === "number") {
    search.set("limit", String(input.limit));
  }

  const response = await trackedFetch(
    `${BASE}/observability/events${search.toString() ? `?${search.toString()}` : ""}`,
    {
      headers: buildAuthHeaders(accessToken),
    }
  );
  return parseJsonOrError<ObservabilityFeedPage>(
    response,
    `Failed to fetch observability events: ${response.status}`
  );
}

export async function getObservabilityThroughput(
  windowHours = 24,
  accessToken?: string
): Promise<ObservabilityThroughputSnapshot> {
  const response = await trackedFetch(`${BASE}/observability/throughput?windowHours=${windowHours}`, {
    headers: buildAuthHeaders(accessToken),
  });
  return parseJsonOrError<ObservabilityThroughputSnapshot>(
    response,
    `Failed to fetch throughput snapshot: ${response.status}`
  );
}

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

export type TeamAssemblySourceType = "free_text" | "notion" | "google-doc" | "markdown";
export type TeamAssemblyModelTier = "lite" | "standard" | "power";
export type TeamAssemblyRoleType = "executive" | "operator";

export interface TeamAssemblyNormalizedGoalDocument {
  sourceType: TeamAssemblySourceType;
  goal: string;
  targetCustomer: string | null;
  successMetrics: string[];
  constraints: string[];
  budget: string | null;
  timeHorizon: string | null;
  importedContextSummary?: string | null;
  planReadinessThreshold: number;
}

export interface TeamAssemblyPrd {
  title: string;
  summary: string;
  targetCustomer: string;
  problemStatement: string;
  proposedSolution: string;
  successMetrics: string[];
  constraints: string[];
  budget: string;
  timeHorizon: string;
  assumptions?: string[];
  risks?: string[];
  openQuestions?: string[];
}

export interface TeamAssemblyRoleLibraryEntry {
  roleKey: string;
  title: string;
  roleType: TeamAssemblyRoleType;
  department: string;
  mandate: string;
  defaultReportsToRoleKey?: string | null;
  defaultSkills?: string[];
  defaultTools?: string[];
  defaultModelTier: TeamAssemblyModelTier;
  hiringSignals?: string[];
}

export interface TeamAssemblyStaffingRecommendation {
  roleKey: string;
  title: string;
  roleType: TeamAssemblyRoleType;
  department: string;
  headcount: number;
  reportsToRoleKey: string | null;
  mandate: string;
  justification: string;
  kpis: string[];
  skills: string[];
  tools: string[];
  modelTier: TeamAssemblyModelTier;
  budgetMonthlyUsd: number | null;
  provisioningInstructions: string;
}

export interface TeamAssemblyResult {
  schemaVersion: string;
  company: {
    name: string | null;
    goal: string;
    targetCustomer: string | null;
    budget: string | null;
    timeHorizon: string | null;
  };
  summary: string;
  rationale: string;
  orgChart: {
    executives: TeamAssemblyStaffingRecommendation[];
    operators: TeamAssemblyStaffingRecommendation[];
    reportingLines: Array<{
      managerRoleKey: string;
      reportRoleKey: string;
    }>;
  };
  provisioningPlan: {
    teamName: string;
    deploymentMode: "continuous_agents";
    agents: TeamAssemblyStaffingRecommendation[];
  };
  roadmap306090: {
    day30: TeamAssemblyPhasePlan;
    day60: TeamAssemblyPhasePlan;
    day90: TeamAssemblyPhasePlan;
  };
}

export interface TeamAssemblyPhasePlan {
  objectives: string[];
  deliverables: string[];
  ownerRoleKeys: string[];
}

export interface TeamAssemblyRequestInput {
  companyName?: string;
  normalizedGoalDocument: TeamAssemblyNormalizedGoalDocument;
  prd?: TeamAssemblyPrd;
  roleLibrary?: TeamAssemblyRoleLibraryEntry[];
}

export interface CompanyRoleTemplate {
  id: string;
  name: string;
  description: string;
  defaultModel: string;
  defaultInstructions: string;
  defaultSkills: string[];
}

export interface CompanyProvisioningContract {
  schemaVersion: string;
  endpoint: string;
  requiredHeaders: string[];
  companyFields: {
    required: string[];
    optional: string[];
  };
  agentFields: {
    identifierFields: string[];
    requiredOneOf: string[];
    optional: string[];
  };
}

export interface CompanyRoleTemplateCatalogResponse {
  roleTemplates: CompanyRoleTemplate[];
  total: number;
  provisioningContract: CompanyProvisioningContract;
}

export interface CompanyProvisioningAgentInput {
  roleTemplateId?: string;
  roleKey?: string;
  name?: string;
  budgetMonthlyUsd?: number;
  model?: string;
  instructions?: string;
  skills?: string[];
}

export interface CompanyProvisioningInput {
  name: string;
  workspaceName?: string;
  externalCompanyId?: string;
  idempotencyKey: string;
  budgetMonthlyUsd: number;
  orchestrationEnabled?: boolean;
  secretBindings: Record<string, string>;
  agents: CompanyProvisioningAgentInput[];
}

export interface ProvisionedCompanySummary {
  id: string;
  userId: string;
  name: string;
  externalCompanyId?: string;
  workspaceId: string;
  teamId: string;
  idempotencyKey: string;
  budgetMonthlyUsd: number;
  allocatedBudgetMonthlyUsd: number;
  remainingBudgetMonthlyUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProvisionedWorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProvisionedSecretSummary {
  key: string;
  maskedValue: string;
}

export interface ProvisioningSkillSummary {
  id: string;
  name: string;
  description: string;
  scope: "workflow" | "agent" | "security" | "integration";
}

export interface CompanyProvisioningResult {
  company: ProvisionedCompanySummary;
  workspace: ProvisionedWorkspaceSummary;
  team: ControlPlaneTeam;
  agents: ControlPlaneAgent[];
  secretBindings: ProvisionedSecretSummary[];
  availableSkills: ProvisioningSkillSummary[];
  idempotentReplay: boolean;
}

export interface ControlPlaneTeamDetail {
  team: ControlPlaneTeam;
  agents: ControlPlaneAgent[];
  tasks: ControlPlaneTask[];
  heartbeats: ControlPlaneHeartbeatRecord[];
}

export interface DeployWorkflowAsTeamInput {
  templateId?: string;
  template?: WorkflowTemplate;
  teamName?: string;
  budgetMonthlyUsd?: number;
  defaultIntervalMinutes?: number;
}

type CreateTemplateInput = Omit<WorkflowTemplate, "id"> & { id?: string };

/** GET /api/templates */
export async function listTemplates(category?: string): Promise<TemplateSummary[]> {
  return withMockApi(
    async () => {
      const url = category ? `${BASE}/templates?category=${encodeURIComponent(category)}` : `${BASE}/templates`;
      const res = await trackedFetch(url);
      if (!res.ok) throw new Error(`Failed to fetch templates: ${res.status}`);
      const data = await res.json();
      return data.templates as TemplateSummary[];
    },
    () => listMockTemplates(category as WorkflowTemplate["category"] | undefined)
  );
}

/** POST /api/templates */
export async function createTemplate(input: CreateTemplateInput): Promise<WorkflowTemplate> {
  return withMockApi(
    async () => {
      const res = await trackedFetch(`${BASE}/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Failed to save template: ${res.status}`);
      }
      return res.json() as Promise<WorkflowTemplate>;
    },
    () => createMockTemplate(input)
  );
}

/** GET /api/templates/:id */
export async function getTemplate(id: string): Promise<WorkflowTemplate> {
  return withMockApi(
    async () => {
      const res = await trackedFetch(`${BASE}/templates/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`Template not found: ${id}`);
      return res.json() as Promise<WorkflowTemplate>;
    },
    () => getMockTemplate(id)
  );
}

/** GET /api/runs */
export async function listRuns(templateId?: string, accessToken?: string): Promise<WorkflowRun[]> {
  return withMockApi(
    async () => {
      const url = templateId
        ? `${BASE}/runs?templateId=${encodeURIComponent(templateId)}`
        : `${BASE}/runs`;
      const res = await trackedFetch(url, {
        headers: buildAuthHeaders(accessToken),
      });
      if (!res.ok) throw new Error(await readApiError(res, `Failed to fetch runs: ${res.status}`));
      const data = await res.json();
      return data.runs as WorkflowRun[];
    },
    () => listMockRuns(templateId)
  );
}

export async function getConnectorHealth(accessToken?: string): Promise<{
  connectors: ConnectorHealthRecord[];
  summary: ConnectorHealthSummary;
}> {
  if (USE_MOCK_API) {
    return {
      connectors: [...MOCK_CONNECTOR_HEALTH],
      summary: summarizeConnectorHealth(MOCK_CONNECTOR_HEALTH),
    };
  }

  const res = await trackedFetch(`${BASE}/connectors/health`, {
    headers: buildAuthHeaders(accessToken),
  });
  if (!res.ok) throw new Error(`Failed to fetch connector health: ${res.status}`);
  const payload = (await res.json()) as {
    connectors: ConnectorHealthRecord[];
    summary: ConnectorHealthSummary;
  };

  if (payload.summary?.source === "mock") {
    throw new Error("Connector health is still serving mock telemetry.");
  }

  return payload;
}

/** GET /api/runs/:id */
export async function getRun(id: string, accessToken?: string): Promise<WorkflowRun> {
  return withMockApi(
    async () => {
      const res = await trackedFetch(`${BASE}/runs/${encodeURIComponent(id)}`, {
        headers: buildAuthHeaders(accessToken),
      });
      if (!res.ok) throw new Error(`Run not found: ${id}`);
      return res.json() as Promise<WorkflowRun>;
    },
    () => getMockRun(id)
  );
}

/** GET /api/control-plane/teams */
export async function listControlPlaneTeams(accessToken?: string): Promise<ControlPlaneTeam[]> {
  return withMockApi(
    async () => {
      const res = await trackedFetch(`${BASE}/control-plane/teams`, {
        headers: buildAuthHeaders(accessToken),
      });
      if (!res.ok) throw new Error(await readApiError(res, `Failed to fetch deployed teams: ${res.status}`));
      const data = await res.json();
      return data.teams as ControlPlaneTeam[];
    },
    () => []
  );
}

/** GET /api/control-plane/teams/:id */
export async function getControlPlaneTeam(
  teamId: string,
  accessToken?: string
): Promise<ControlPlaneTeamDetail> {
  return withMockApi(
    async () => {
      const res = await trackedFetch(`${BASE}/control-plane/teams/${encodeURIComponent(teamId)}`, {
        headers: buildAuthHeaders(accessToken),
      });
      if (!res.ok) throw new Error(await readApiError(res, `Failed to fetch deployed team: ${res.status}`));
      return res.json() as Promise<ControlPlaneTeamDetail>;
    },
    () => {
      throw new Error(`Deployed team not found: ${teamId}`);
    }
  );
}

/** POST /api/control-plane/deployments/workflow */
export async function deployWorkflowAsTeam(
  input: DeployWorkflowAsTeamInput,
  accessToken?: string,
  runId = globalThis.crypto?.randomUUID?.() ?? `control-plane-${Date.now()}`
): Promise<ControlPlaneDeployment> {
  const res = await trackedFetch(`${BASE}/control-plane/deployments/workflow`, {
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

export async function generateTeamAssemblyPlan(
  input: TeamAssemblyRequestInput,
  accessToken?: string
): Promise<TeamAssemblyResult> {
  const res = await trackedFetch(`${BASE}/goals/team-assembly`, {
    method: "POST",
    headers: buildJsonHeaders(accessToken),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? `Failed to generate staffing plan: ${res.status}`);
  }
  return res.json() as Promise<TeamAssemblyResult>;
}

export async function listCompanyRoleTemplates(
  accessToken?: string
): Promise<CompanyRoleTemplateCatalogResponse> {
  const res = await trackedFetch(`${BASE}/companies/role-templates`, {
    headers: buildAuthHeaders(accessToken),
  });
  return parseJsonOrError<CompanyRoleTemplateCatalogResponse>(
    res,
    `Failed to fetch company role templates: ${res.status}`
  );
}

export async function provisionCompanyWorkspace(
  input: CompanyProvisioningInput,
  accessToken?: string,
  runId = globalThis.crypto?.randomUUID?.() ?? `company-provision-${Date.now()}`
): Promise<CompanyProvisioningResult> {
  const res = await trackedFetch(`${BASE}/companies`, {
    method: "POST",
    headers: buildJsonHeaders(accessToken, {
      "X-Paperclip-Run-Id": runId,
    }),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? `Failed to provision company workspace: ${res.status}`);
  }
  return res.json() as Promise<CompanyProvisioningResult>;
}

/** POST /api/runs */
export async function startRun(
  templateId: string,
  input: Record<string, unknown>,
  config?: Record<string, unknown>,
  accessToken?: string
): Promise<WorkflowRun> {
  return withMockApi(
    async () => {
      const res = await trackedFetch(`${BASE}/runs`, {
        method: "POST",
        headers: buildJsonHeaders(accessToken),
        body: JSON.stringify({ templateId, input, config }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Failed to start run: ${res.status}`);
      }
      return res.json() as Promise<WorkflowRun>;
    },
    () => startMockRun(templateId, input)
  );
}

/** POST /api/workflows/generate — NL description → workflow steps */
export async function generateWorkflow(
  description: string,
  llmConfigId?: string,
  accessToken?: string
): Promise<WorkflowStep[]> {
  const res = await trackedFetch(`${BASE}/workflows/generate`, {
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

  return withMockApi(
    async () => {
      const res = await trackedFetch(`${BASE}/runs/file`, { method: "POST", headers, body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Failed to start file run: ${res.status}`);
      }
      return res.json() as Promise<WorkflowRun>;
    },
    () => startMockRun(templateId, { fileName: file.name || "mock-upload" })
  );
}

/** POST /api/debug/step — AI debugger for failed steps */
export async function debugStep(
  stepId: string,
  error: string,
  output: Record<string, unknown>
): Promise<{ explanation: string; suggestion: string }> {
  const res = await trackedFetch(`${BASE}/debug/step`, {
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
  const res = await trackedFetch(`${BASE}/proposals/context`, {
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
  const res = await trackedFetch(`${BASE}/proposals`, {
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
  const res = await trackedFetch(`${BASE}/proposals/${encodeURIComponent(jobId)}`, {
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
  const res = await trackedFetch(url, { headers: getMemoryHeaders(accessToken, userId) });
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
  const res = await trackedFetch(`${BASE}/memory/search?${params.toString()}`, {
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
  const res = await trackedFetch(`${BASE}/memory`, {
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
  const res = await trackedFetch(`${BASE}/memory/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: getMemoryHeaders(accessToken, userId),
  });
  if (!res.ok && res.status !== 404) throw new Error(`Failed to delete memory entry: ${res.status}`);
}

/** GET /api/memory/stats — usage stats */
export async function getMemoryStats(accessToken: string, userId?: string): Promise<MemoryStats> {
  const res = await trackedFetch(`${BASE}/memory/stats`, { headers: getMemoryHeaders(accessToken, userId) });
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
  return withMockApi(
    async () => {
      const url = status
        ? `${BASE}/approvals?status=${encodeURIComponent(status)}`
        : `${BASE}/approvals`;
      const res = await trackedFetch(url, { headers: buildAuthHeaders(accessToken) });
      if (!res.ok) throw new Error(`Failed to fetch approvals: ${res.status}`);
      const data = await res.json();
      return data.approvals as ApprovalRequest[];
    },
    () => []
  );
}

/** POST /api/approvals/:id/resolve */
export async function resolveApproval(
  id: string,
  decision: "approved" | "rejected",
  accessToken: string,
  comment?: string
): Promise<void> {
  const res = await trackedFetch(`${BASE}/approvals/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...buildAuthHeaders(accessToken) },
    body: JSON.stringify({ decision, comment }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? `Failed to resolve approval: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// HITL API — checkpoints, comments, Ask the CEO, and schedule controls
// ---------------------------------------------------------------------------

export type HitlNotificationChannel = "inbox" | "email" | "agent_wake";
export type HitlRecipientType = "agent" | "user";
export type HitlCheckpointTriggerType =
  | "end_of_week_review"
  | "milestone_gate"
  | "kpi_deviation"
  | "manual";
export type HitlCheckpointStatus = "pending" | "acknowledged" | "resolved" | "dismissed";
export type HitlCommentStatus = "open" | "resolved";

export interface HitlKpiThreshold {
  metricKey: string;
  comparator: "gt" | "gte" | "lt" | "lte" | "percent_drop";
  threshold: number;
  window: "hour" | "day" | "week";
}

export interface HitlCheckpointSchedule {
  id: string;
  companyId: string;
  userId: string;
  enabled: boolean;
  timezone: string;
  notificationChannels: HitlNotificationChannel[];
  weeklyReview: {
    enabled: boolean;
    dayOfWeek: number;
    hour: number;
    minute: number;
  };
  milestoneGate: {
    enabled: boolean;
    blockingStatuses: string[];
  };
  kpiDeviation: {
    enabled: boolean;
    thresholds: HitlKpiThreshold[];
  };
  createdAt: string;
  updatedAt: string;
}

export interface HitlCheckpoint {
  id: string;
  companyId: string;
  userId: string;
  triggerType: HitlCheckpointTriggerType;
  source: "system" | "manual";
  title: string;
  description?: string;
  status: HitlCheckpointStatus;
  dueAt?: string;
  artifactRefs: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  notificationIds: string[];
}

export interface HitlArtifactComment {
  id: string;
  companyId: string;
  userId: string;
  artifact: {
    kind: "ticket" | "approval" | "run" | "document" | "workflow_step" | "other";
    id: string;
    title?: string;
    path?: string;
    version?: string;
  };
  anchor?: {
    quote?: string;
    lineStart?: number;
    lineEnd?: number;
    startOffset?: number;
    endOffset?: number;
    fieldKey?: string;
  };
  body: string;
  status: HitlCommentStatus;
  routing: {
    recipientType: HitlRecipientType;
    recipientId: string;
    responsibleAgentId?: string;
    reason?: string;
  };
  createdAt: string;
  updatedAt: string;
  notificationIds: string[];
}

export interface HitlAskCeoRequest {
  id: string;
  companyId: string;
  userId: string;
  question: string;
  context?: {
    artifactRef?: string;
    taskId?: string;
    checkpointId?: string;
  };
  status: "answered";
  response: {
    summary: string;
    recommendedActions: string[];
    citedEntities: Array<{
      type: "team" | "task" | "checkpoint" | "artifact_comment";
      id: string;
      label: string;
    }>;
    companyStateVersion: string;
  };
  createdAt: string;
}

export interface HitlNotification {
  id: string;
  companyId: string;
  userId: string;
  kind: "checkpoint" | "artifact_comment" | "ask_ceo_response";
  channel: HitlNotificationChannel;
  recipientType: HitlRecipientType;
  recipientId: string;
  status: "pending" | "sent" | "failed";
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface HitlCompanyState {
  companyId: string;
  version: string;
  summary: {
    companyId: string;
    version: string;
    team: {
      id: string;
      name: string;
      status: string;
      budgetMonthlyUsd: number;
      agentCount: number;
      activeExecutionCount: number;
      openTaskCount: number;
    } | null;
    hitl: {
      openCheckpointCount: number;
      unresolvedCommentCount: number;
      askCeoRequestCount: number;
    };
  };
  checkpointSchedule: HitlCheckpointSchedule;
  checkpoints: HitlCheckpoint[];
  artifactComments: HitlArtifactComment[];
  askCeoRequests: HitlAskCeoRequest[];
}

export interface UpdateHitlCheckpointScheduleInput {
  enabled?: boolean;
  timezone?: string;
  notificationChannels?: HitlNotificationChannel[];
  weeklyReview?: Partial<HitlCheckpointSchedule["weeklyReview"]>;
  milestoneGate?: Partial<HitlCheckpointSchedule["milestoneGate"]>;
  kpiDeviation?: {
    enabled?: boolean;
    thresholds?: HitlKpiThreshold[];
  };
}

export interface CreateHitlCheckpointInput {
  triggerType?: HitlCheckpointTriggerType;
  title: string;
  description?: string;
  dueAt?: string;
  artifactRefs?: string[];
  metadata?: Record<string, unknown>;
  recipientType: HitlRecipientType;
  recipientId: string;
}

export interface CreateHitlArtifactCommentInput {
  artifact: HitlArtifactComment["artifact"];
  anchor?: HitlArtifactComment["anchor"];
  body: string;
  routing: HitlArtifactComment["routing"];
}

export interface CreateHitlAskCeoRequestInput {
  question: string;
  context?: HitlAskCeoRequest["context"];
}

function createPaperclipRunId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `hitl-${Date.now()}`;
}

/** GET /api/hitl/companies/:companyId/state */
export async function getHitlCompanyState(
  companyId: string,
  accessToken?: string
): Promise<HitlCompanyState> {
  const res = await trackedFetch(`${BASE}/hitl/companies/${encodeURIComponent(companyId)}/state`, {
    headers: buildAuthHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `Failed to fetch HITL state: ${res.status}`));
  }
  return res.json() as Promise<HitlCompanyState>;
}

/** GET /api/hitl/companies/:companyId/notifications */
export async function listHitlNotifications(
  companyId: string,
  accessToken?: string
): Promise<HitlNotification[]> {
  const res = await trackedFetch(`${BASE}/hitl/companies/${encodeURIComponent(companyId)}/notifications`, {
    headers: buildAuthHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `Failed to fetch HITL notifications: ${res.status}`));
  }
  const data = await res.json();
  return data.notifications as HitlNotification[];
}

/** PUT /api/hitl/companies/:companyId/checkpoint-schedule */
export async function updateHitlCheckpointSchedule(
  companyId: string,
  input: UpdateHitlCheckpointScheduleInput,
  accessToken?: string,
  runId = createPaperclipRunId()
): Promise<HitlCheckpointSchedule> {
  const res = await trackedFetch(`${BASE}/hitl/companies/${encodeURIComponent(companyId)}/checkpoint-schedule`, {
    method: "PUT",
    headers: buildJsonHeaders(accessToken, {
      "X-Paperclip-Run-Id": runId,
    }),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `Failed to update HITL schedule: ${res.status}`));
  }
  const data = await res.json();
  return data.schedule as HitlCheckpointSchedule;
}

/** POST /api/hitl/companies/:companyId/checkpoints */
export async function createHitlCheckpoint(
  companyId: string,
  input: CreateHitlCheckpointInput,
  accessToken?: string,
  runId = createPaperclipRunId()
): Promise<HitlCheckpoint> {
  const res = await trackedFetch(`${BASE}/hitl/companies/${encodeURIComponent(companyId)}/checkpoints`, {
    method: "POST",
    headers: buildJsonHeaders(accessToken, {
      "X-Paperclip-Run-Id": runId,
    }),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `Failed to create HITL checkpoint: ${res.status}`));
  }
  const data = await res.json();
  return data.checkpoint as HitlCheckpoint;
}

/** POST /api/hitl/companies/:companyId/artifact-comments */
export async function createHitlArtifactComment(
  companyId: string,
  input: CreateHitlArtifactCommentInput,
  accessToken?: string,
  runId = createPaperclipRunId()
): Promise<HitlArtifactComment> {
  const res = await trackedFetch(`${BASE}/hitl/companies/${encodeURIComponent(companyId)}/artifact-comments`, {
    method: "POST",
    headers: buildJsonHeaders(accessToken, {
      "X-Paperclip-Run-Id": runId,
    }),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `Failed to create HITL comment: ${res.status}`));
  }
  const data = await res.json();
  return data.comment as HitlArtifactComment;
}

/** POST /api/hitl/companies/:companyId/ask-ceo/requests */
export async function createHitlAskCeoRequest(
  companyId: string,
  input: CreateHitlAskCeoRequestInput,
  accessToken?: string,
  runId = createPaperclipRunId()
): Promise<HitlAskCeoRequest> {
  const res = await trackedFetch(`${BASE}/hitl/companies/${encodeURIComponent(companyId)}/ask-ceo/requests`, {
    method: "POST",
    headers: buildJsonHeaders(accessToken, {
      "X-Paperclip-Run-Id": runId,
    }),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `Failed to ask the CEO: ${res.status}`));
  }
  const data = await res.json();
  return data.request as HitlAskCeoRequest;
}
