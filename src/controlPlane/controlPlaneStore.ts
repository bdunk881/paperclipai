import { randomUUID } from "crypto";
import { PoolClient } from "pg";
import { WorkflowStep, WorkflowTemplate } from "../types/workflow";
import { DEFAULT_ROLE_LIBRARY } from "../goals/teamAssembly";
import { getPostgresPool, inMemoryAllowed, isPostgresConfigured } from "../db/postgres";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import { assertAgentWorkspaceBinding } from "../security/agentWorkspaceBinding";
import { companyLifecycleStore } from "./companyLifecycleStore";
import {
  AgentHeartbeatRecord,
  BudgetStatusSnapshot,
  CompanyProvisioningAgentInput,
  ControlPlaneMissionState,
  CompanyProvisioningResult,
  ControlPlaneAgent,
  ControlPlaneBudgetAlert,
  ControlPlaneDeployment,
  ControlPlaneExecution,
  ControlPlaneExecutionStatus,
  ControlPlaneLifecycleAction,
  ControlPlaneRoleTemplateDefinition,
  ControlPlaneSkillDefinition,
  ControlPlaneSpendEntry,
  ControlPlaneTask,
  ControlPlaneTaskAuditEvent,
  ControlPlaneTaskStatus,
  ControlPlaneTeam,
  HeartbeatStatus,
  ProvisionedCompanyRecord,
  ProvisionedCompanySecretBinding,
  ProvisionedCompanyWorkspace,
  SpendCategory,
  TeamSpendSnapshot,
} from "./types";
import { observabilityStore } from "../observability/store";
import { secretsRepository } from "./secretsRepository";
import {
  __resetRepositoryInMemoryStateForTests,
  controlPlaneRepository,
} from "./controlPlaneRepository";

function nowIso(): string {
  return new Date().toISOString();
}

function currentPeriodKey(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

function periodKeyFromIso(iso: string): string {
  return iso.slice(0, 7);
}

function budgetAlertDedupeKey(input: {
  userId: string;
  teamId: string;
  period: string;
  scope: ControlPlaneBudgetAlert["scope"];
  agentId?: string;
  toolName?: string;
  threshold: number;
}): string {
  return [
    input.userId,
    input.teamId,
    input.period,
    input.scope,
    input.agentId ?? "",
    input.toolName ?? "",
    input.threshold,
  ].join(":");
}

const SLUGIFY_MAX_INPUT_LENGTH = 256;

function slugify(value: string): string {
  const bounded = value.slice(0, SLUGIFY_MAX_INPUT_LENGTH);
  const lower = bounded.trim().toLowerCase();
  const chars: number[] = [];
  let lastWasDash = false;
  for (let i = 0; i < lower.length; i += 1) {
    const code = lower.charCodeAt(i);
    const isAlnum =
      (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
    if (isAlnum) {
      chars.push(code);
      lastWasDash = false;
    } else if (!lastWasDash) {
      chars.push(45);
      lastWasDash = true;
    }
  }

  let start = 0;
  let end = chars.length;
  while (start < end && chars[start] === 45) {
    start += 1;
  }
  while (end > start && chars[end - 1] === 45) {
    end -= 1;
  }

  return String.fromCharCode(...chars.slice(start, end));
}

function buildAuditEvent(
  type: ControlPlaneTaskAuditEvent["type"],
  actor: string,
  detail: string
): ControlPlaneTaskAuditEvent {
  return {
    id: randomUUID(),
    type,
    actor,
    detail,
    timestamp: nowIso(),
  };
}

function inferObservabilityActor(actor: string): { type: "run" | "system"; id: string; label?: string } {
  if (actor.startsWith("run-")) {
    return { type: "run", id: actor, label: actor };
  }
  return { type: "system", id: actor, label: actor };
}

function toAgentStatus(action: ControlPlaneLifecycleAction): ControlPlaneAgent["status"] {
  switch (action) {
    case "pause":
      return "paused";
    case "stop":
      return "terminated";
    case "restart":
    case "resume":
      return "active";
  }
}

function inferRoleKey(step: WorkflowStep, index?: number): string {
  return step.agentRoleKey ?? `${slugify(step.kind)}${index !== undefined ? `-${index + 1}` : ""}`;
}

function inferSkills(step: WorkflowStep): string[] {
  return Array.isArray(step.agentSkills)
    ? step.agentSkills.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
}

function toHeartbeatStatus(status: ControlPlaneExecutionStatus): HeartbeatStatus {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "blocked":
      return "blocked";
    case "completed":
    case "failed":
    case "stopped":
      return "completed";
  }
}

function shouldResetLegacyAgentErrorStatus(heartbeatStatus: HeartbeatStatus): boolean {
  return heartbeatStatus === "running" || heartbeatStatus === "completed";
}

function normalizeAgentStatusForSuccessfulHeartbeat(
  agent: ControlPlaneAgent,
  heartbeatStatus: HeartbeatStatus
): void {
  if (shouldResetLegacyAgentErrorStatus(heartbeatStatus) && (agent.status as string) === "error") {
    agent.status = "active";
  }
}

function modelForTier(tier: "lite" | "standard" | "power"): string {
  switch (tier) {
    case "lite":
      return "gpt-5.4-mini";
    case "standard":
      return "gpt-5.4";
    case "power":
      return "gpt-5.2";
  }
}

function thresholdStateForPercent(percentUsed: number): BudgetStatusSnapshot["thresholdState"] {
  if (percentUsed >= 1) {
    return "limit_reached";
  }
  if (percentUsed >= 0.9) {
    return "critical";
  }
  if (percentUsed >= 0.8) {
    return "warning";
  }
  return "healthy";
}

const BASE_SKILL_CATALOG: ControlPlaneSkillDefinition[] = [
  {
    id: "paperclip",
    name: "paperclip",
    description: "Paperclip control-plane coordination and issue management.",
    scope: "workflow",
  },
  {
    id: "security-review",
    name: "security-review",
    description: "Secure coding checklist and review patterns for sensitive changes.",
    scope: "security",
  },
  {
    id: "openai-docs",
    name: "openai-docs",
    description: "Official OpenAI documentation retrieval and upgrade guidance.",
    scope: "integration",
  },
  {
    id: "gh-cli",
    name: "gh-cli",
    description: "GitHub CLI execution support for repository and CI workflows.",
    scope: "agent",
  },
];

const SKILL_CATALOG: ControlPlaneSkillDefinition[] = [
  ...BASE_SKILL_CATALOG,
  ...Array.from(
    new Set(DEFAULT_ROLE_LIBRARY.flatMap((role) => role.defaultSkills).filter((skill) => skill !== "paperclip"))
  ).map((skill) => ({
    id: skill,
    name: skill,
    description: `AutoFlow role skill ${skill}.`,
    scope: "agent" as const,
  })),
];

const BASE_ROLE_TEMPLATE_CATALOG: ControlPlaneRoleTemplateDefinition[] = [
  {
    id: "workspace-manager",
    name: "Workspace Manager",
    description: "Coordinates tenant-level provisioning, operations, and audit trail ownership.",
    defaultModel: "gpt-5.4",
    defaultInstructions:
      "Own workspace-level orchestration, keep tenant systems healthy, and coordinate downstream agents.",
    defaultSkills: ["paperclip"],
  },
  {
    id: "backend-engineer",
    name: "Backend Engineer",
    description: "Implements APIs, data models, and server-side integrations for the tenant.",
    defaultModel: "gpt-5.4",
    defaultInstructions:
      "Build and maintain backend APIs, integrations, and persistence for the customer workspace.",
    defaultSkills: ["paperclip", "security-review"],
  },
  {
    id: "integration-engineer",
    name: "Integration Engineer",
    description: "Owns third-party connectors, credentials, and external system setup for the tenant.",
    defaultModel: "gpt-5.4",
    defaultInstructions:
      "Configure and maintain customer integrations, credentials, and operational playbooks.",
    defaultSkills: ["paperclip", "openai-docs"],
  },
  {
    id: "github-operator",
    name: "GitHub Operator",
    description: "Handles repository automation, PR workflows, and CI follow-up tasks.",
    defaultModel: "gpt-5.4-mini",
    defaultInstructions:
      "Operate GitHub workflows safely, with strong auditability and fast CI feedback loops.",
    defaultSkills: ["paperclip", "gh-cli"],
  },
];

const ROLE_TEMPLATE_CATALOG: ControlPlaneRoleTemplateDefinition[] = [
  ...BASE_ROLE_TEMPLATE_CATALOG,
  ...DEFAULT_ROLE_LIBRARY.filter(
    (role) => !BASE_ROLE_TEMPLATE_CATALOG.some((template) => template.id === role.roleKey)
  ).map((role) => ({
    id: role.roleKey,
    name: role.title,
    description: role.mandate,
    defaultModel: modelForTier(role.defaultModelTier),
    defaultInstructions: role.mandate,
    defaultSkills: [...role.defaultSkills],
  })),
];
// DASH-64.1: `tasks` Map removed. All task reads/writes now route
// through `controlPlaneRepository` (Postgres-first; in-memory fallback
// for test mode lives in the repository module itself per HEL-80).
// DASH-64.2: `heartbeats` Map removed. All heartbeat reads/writes now
// route through `controlPlaneRepository` (Postgres-first; in-memory
// fallback for test mode lives in the repository module itself).
// DASH-64.3: `spendEntries` and `budgetAlerts` Maps removed for the
// same reason — repository is the single source of truth.
// DASH-64.4: `executions` Map removed. Reads/writes route through
// `controlPlaneRepository` (Postgres-first; in-memory fallback for
// test mode lives in the repository module per HEL-80).
// DASH-64.5: `agents` Map removed. Same pattern — repository owns
// agent reads/writes (Postgres in prod, in-memory bucket in tests).
// DASH-64.6: `teams` Map removed. Same pattern.
// DASH-64.7: `companies` + `companyWorkspaces` + `companySecretBindings`
// + `companyIdempotencyIndex` Maps removed. All four are now backed by
// controlPlaneRepository (Postgres `companies` table in prod, in-memory
// fallback in tests). companyIdempotencyIndex is derivable on demand by
// scanning the user's companies for a matching idempotencyKey.
// companySecretBindings stays in the in-memory fallback only — prod
// uses secretsRepository for encrypted-at-rest secrets.
// DASH-64.3: spendEntries + budgetAlerts Maps removed. Both route
// through controlPlaneRepository now.
// allowlist: hybrid store; in-memory mirror of Postgres-backed data
const teamWorkspaceIds = new Map<string, string>();
// allowlist: hybrid store; in-memory mirror of Postgres-backed data
const teamCompanyIds = new Map<string, string>();
// allowlist: hybrid store; in-memory mirror of Postgres-backed data
const companyTenantWorkspaceIds = new Map<string, string>();
const hydratedWorkspaceUsers = new Set<string>();

type PersistedTeamRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  company_id: string | null;
  name: string;
  description: string | null;
  workflow_template_id: string | null;
  workflow_template_name: string | null;
  deployment_mode: ControlPlaneTeam["deploymentMode"];
  status: ControlPlaneTeam["status"];
  paused_by_company_lifecycle: boolean;
  restart_count: number;
  budget_monthly_usd: number | string;
  tool_budget_ceilings: unknown;
  alert_thresholds: unknown;
  orchestration_enabled: boolean;
  last_heartbeat_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

// DASH-64.4: PersistedExecutionRow lives in controlPlaneRepository now.
// DASH-64.5: PersistedAgentRow lives in controlPlaneRepository now.

// DASH-64.7: PersistedProvisionedCompanyRow lives in controlPlaneRepository now.
interface PersistedProvisionedCompanyRow {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  external_company_id: string | null;
  provisioned_workspace_id: string;
  provisioned_workspace_name: string;
  provisioned_workspace_slug: string;
  team_id: string;
  idempotency_key: string;
  budget_monthly_usd: number | string;
  allocated_budget_monthly_usd: number | string;
  remaining_budget_monthly_usd: number | string;
  created_at: Date | string;
  updated_at: Date | string;
}

function getSkillCatalogIds(): Set<string> {
  return new Set(SKILL_CATALOG.map((skill) => skill.id));
}

function getRoleTemplateById(roleTemplateId: string): ControlPlaneRoleTemplateDefinition | undefined {
  return ROLE_TEMPLATE_CATALOG.find((template) => template.id === roleTemplateId);
}

function ensureValidSkillIds(skillIds: string[]): void {
  const validSkillIds = getSkillCatalogIds();
  const invalidSkills = skillIds.filter((skill) => !validSkillIds.has(skill));
  if (invalidSkills.length > 0) {
    throw new Error(`invalid_skills:${invalidSkills.join(",")}`);
  }
}

function mergeSkills(defaultSkills: string[], requestedSkills: string[] = []): string[] {
  const merged = Array.from(new Set([...defaultSkills, ...requestedSkills]));
  ensureValidSkillIds(merged);
  return merged.sort();
}

function maskSecretValue(secret: string): string {
  const trimmed = secret.trim();
  if (!trimmed) {
    return "****";
  }
  const suffix = trimmed.slice(-4);
  return `${"*".repeat(Math.max(8, trimmed.length - suffix.length))}${suffix}`;
}

function buildCompanySecretSummaries(secretBindings: Record<string, string>): ProvisionedCompanySecretBinding[] {
  return Object.entries(secretBindings)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({
      key,
      maskedValue: maskSecretValue(value),
    }));
}

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }
  return 0;
}

function normalizeNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.entries(value).reduce<Record<string, number>>((acc, [key, entryValue]) => {
    if (typeof entryValue === "number") {
      acc[key] = entryValue;
      return acc;
    }
    if (typeof entryValue === "string" && entryValue.trim().length > 0) {
      acc[key] = Number(entryValue);
    }
    return acc;
  }, {});
}

function normalizeNumberArray(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const parsed = value.filter((entry): entry is number => typeof entry === "number");
  return parsed.length > 0 ? [...parsed].sort((left, right) => left - right) : [...fallback];
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function normalizeSchedule(value: unknown): ControlPlaneAgent["schedule"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { type: "manual" };
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.type === "interval" && typeof candidate.intervalMinutes === "number") {
    return { type: "interval", intervalMinutes: candidate.intervalMinutes };
  }
  if (candidate.type === "cron" && typeof candidate.cronExpression === "string") {
    return { type: "cron", cronExpression: candidate.cronExpression };
  }
  return { type: "manual" };
}

function requireWorkspaceIdForPersistence(workspaceId: string | undefined): string {
  if (!workspaceId?.trim()) {
    throw new Error("workspace_context_required");
  }
  return workspaceId;
}

function postgresPersistenceAvailable(): boolean {
  if (isPostgresConfigured()) {
    return true;
  }
  if (inMemoryAllowed()) {
    return false;
  }
  throw new Error("controlPlaneStore requires DATABASE_URL outside development/test.");
}

function workspaceUserKey(workspaceId: string, userId: string): string {
  return `${workspaceId}:${userId}`;
}

/**
 * Resolves the workspace context for a given teamId. HEL-66:
 *
 * - Primary path: hit the in-memory `teamWorkspaceIds` cache (populated
 *   when teams are loaded / created).
 * - Cache miss: look up `agent_teams.workspace_id` in Postgres (single
 *   small SELECT). On hit, populate the cache so future calls don't pay
 *   the DB round-trip again.
 * - DB miss: return undefined (genuinely unknown team — caller decides
 *   how to handle, usually by surfacing a 404 upstream).
 *
 * Without this fallback, `controlPlaneStore` ops that fired right after a
 * cold start (before teams had been listed once and hydrated the cache)
 * would land in observabilityStore.record() with workspaceId=undefined,
 * which then dropped the DB persist — silent durability gap on activity
 * events.
 */
async function workspaceContextForTeam(
  teamId: string,
  userId: string,
): Promise<{ workspaceId: string; userId: string } | undefined> {
  // DASH-64.1: cache hit works in BOTH production AND test mode now.
  // Pre-DASH-64.1 we returned `undefined` in test mode (Postgres
  // unavailable) and relied on the in-memory `tasks` Map. With the Map
  // gone, the repository's in-memory fallback needs a workspaceId to
  // bucket by — and the cached value from teamWorkspaceIds is reliable
  // because teams set it on create regardless of mode.
  const cached = teamWorkspaceIds.get(teamId);
  if (cached) {
    return { workspaceId: cached, userId };
  }
  if (!postgresPersistenceAvailable()) {
    // Test mode + no cache hit. Some test-mode code paths (auto-
    // provisioned teams in stepHandlers, tests that bypass the
    // workspace-aware routes) create teams without an explicit
    // workspaceId. Fall back to userId — same convention as
    // `resolveWorkspaceContext` in test mode, and the repository's
    // in-memory fallback will bucket by this same value.
    return { workspaceId: userId, userId };
  }
  // Cache miss — call the SECURITY DEFINER helper to bypass RLS. We
  // can't use the regular workspace-context channel here because the
  // whole point of this lookup is to FIND the workspace_id; we don't
  // have one to set on the session yet. agent_teams has FORCE RLS
  // requiring app_current_workspace_id() IS NOT NULL, so a raw SELECT
  // would return zero rows for a legitimate team.
  // The helper is migration 030's `lookup_team_workspace_id(uuid)`.
  try {
    const result = await getPostgresPool().query<{ workspace_id: string | null }>(
      `SELECT lookup_team_workspace_id($1) AS workspace_id`,
      [teamId],
    );
    const workspaceId = result.rows[0]?.workspace_id;
    if (!workspaceId) {
      return undefined;
    }
    teamWorkspaceIds.set(teamId, workspaceId);
    return { workspaceId, userId };
  } catch (err) {
    console.warn(
      `[controlPlaneStore] workspaceContextForTeam DB lookup failed for team=${teamId}: ${(err as Error).message}`,
    );
    return undefined;
  }
}

function matchesWorkspace(teamId: string, workspaceId?: string): boolean {
  if (!workspaceId) {
    return true;
  }

  const storedWorkspaceId = teamWorkspaceIds.get(teamId);
  return storedWorkspaceId ? storedWorkspaceId === workspaceId : true;
}

function serializeProvisioningFingerprint(input: {
  name: string;
  workspaceName?: string;
  externalCompanyId?: string;
  budgetMonthlyUsd: number;
  orchestrationEnabled?: boolean;
  secretBindings: Record<string, string>;
  agents: CompanyProvisioningAgentInput[];
}): string {
  const normalizedSecrets = Object.entries(input.secretBindings)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, value]);
  const normalizedAgents = input.agents.map((agent) => ({
    roleTemplateId: agent.roleTemplateId,
    name: agent.name?.trim() ?? null,
    budgetMonthlyUsd: agent.budgetMonthlyUsd ?? null,
    model: agent.model?.trim() ?? null,
    instructions: agent.instructions?.trim() ?? null,
    skills: [...(agent.skills ?? [])].sort(),
  }));
  return JSON.stringify({
    name: input.name.trim(),
    workspaceName: input.workspaceName?.trim() ?? null,
    externalCompanyId: input.externalCompanyId?.trim() ?? null,
    budgetMonthlyUsd: input.budgetMonthlyUsd,
    orchestrationEnabled: input.orchestrationEnabled ?? true,
    secretBindings: normalizedSecrets,
    agents: normalizedAgents,
  });
}

function makeProvisioningRoleKey(roleTemplateId: string, occurrence: number): string {
  return occurrence === 0 ? roleTemplateId : `${roleTemplateId}-${occurrence + 1}`;
}

/**
 * DASH-64.7: replaces the synchronous Map lookup. Resolves the
 * company via the repository (cross-workspace SECURITY DEFINER helper
 * when no workspace context is pinned).
 */
async function getProvisionedCompanyOwnedByUser(
  companyId: string,
  userId: string,
): Promise<ProvisionedCompanyRecord | undefined> {
  const all = await controlPlaneRepository.listAllProvisionedCompaniesForUser(userId);
  const entry = all.find((candidate) => candidate.company.id === companyId);
  return entry?.company;
}

function latestIso(...timestamps: Array<string | undefined>): string {
  return timestamps
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right))
    .at(-1) ?? nowIso();
}

async function buildMissionState(
  team: ControlPlaneTeam,
): Promise<ControlPlaneMissionState> {
  // DASH-64.1: tasks read via repository instead of in-memory Map.
  // DASH-64.5: agents read via repository (same workspace context).
  // The workspace context comes from the team row — teams still live in
  // the in-memory store until DASH-64.6, so this is safe to read sync.
  const teamWorkspaceId = teamWorkspaceIds.get(team.id);
  const teamAgents: ControlPlaneAgent[] = teamWorkspaceId
    ? (
        await controlPlaneRepository.listAgents(
          { workspaceId: teamWorkspaceId, userId: team.userId },
          { teamId: team.id },
        )
      ).filter((agent) => agent.userId === team.userId)
    : [];
  const teamTasks: ControlPlaneTask[] = teamWorkspaceId
    ? await controlPlaneRepository.listTasks(
        { workspaceId: teamWorkspaceId, userId: team.userId },
        { teamId: team.id },
      )
    : [];
  // DASH-64.4: executions read via repository (same workspace context
  // as teamTasks above — teams remain in-memory until DASH-64.6).
  const teamExecutions: ControlPlaneExecution[] = teamWorkspaceId
    ? await controlPlaneRepository.listExecutions(
        { workspaceId: teamWorkspaceId, userId: team.userId },
        { teamId: team.id },
      )
    : [];
  // DASH-64.3: buildTeamSpendSnapshot is now async.
  const spendSnapshot = await buildTeamSpendSnapshot(team);
  const blockedTasks = teamTasks.filter((task) => task.status === "blocked");
  const failedExecutions = teamExecutions.filter((execution) => execution.status === "failed");
  const blockedExecutions = teamExecutions.filter((execution) => execution.status === "blocked");
  const hasRuntimeActivity = teamTasks.length > 0 || teamExecutions.length > 0;

  let overallStatus: ControlPlaneMissionState["overallStatus"] = "on_track";
  if (!hasRuntimeActivity) {
    overallStatus = "not_started";
  } else if (team.status === "stopped" || failedExecutions.length > 0) {
    overallStatus = "off_track";
  } else if (team.status === "paused" || blockedTasks.length > 0) {
    overallStatus = "blocked";
  } else if (
    blockedExecutions.length > 0 ||
    spendSnapshot.team.thresholdState === "warning" ||
    spendSnapshot.team.thresholdState === "critical" ||
    spendSnapshot.team.thresholdState === "limit_reached"
  ) {
    overallStatus = "at_risk";
  }

  const plannedHeadcount = teamAgents.length;
  const filledHeadcount = teamAgents.filter((agent) => agent.status !== "terminated").length;
  let staffingStatus: ControlPlaneMissionState["staffingReadiness"]["status"] = "ready";
  if (filledHeadcount === 0) {
    staffingStatus = "not_ready";
  } else if (filledHeadcount < plannedHeadcount) {
    staffingStatus = "partial";
  }

  const risks: string[] = [];
  if (spendSnapshot.team.thresholdState === "warning" || spendSnapshot.team.thresholdState === "critical") {
    risks.push(`Budget usage is ${Math.round(spendSnapshot.team.percentUsed * 100)}% of monthly allocation.`);
  }
  if (spendSnapshot.team.thresholdState === "limit_reached") {
    risks.push("Team budget limit has been reached.");
  }
  if (failedExecutions.length > 0) {
    risks.push(`${failedExecutions.length} execution${failedExecutions.length === 1 ? "" : "s"} failed.`);
  }

  const topBlockers = blockedTasks.map((task) => task.title);
  if (team.status === "paused" && topBlockers.length === 0) {
    topBlockers.push("Team is currently paused.");
  }
  if (team.status === "stopped" && topBlockers.length === 0) {
    topBlockers.push("Team is currently stopped.");
  }

  return {
    teamId: team.id,
    title: team.name,
    objective: team.description?.trim() || null,
    overallStatus,
    currentPhase: null,
    ownerTeam: team.name,
    staffingReadiness: {
      status: staffingStatus,
      filledHeadcount,
      plannedHeadcount,
    },
    topBlockers,
    risks: Array.from(new Set(risks)),
    nextMilestone: null,
    lastUpdated: latestIso(
      team.updatedAt,
      ...teamTasks.map((task) => task.updatedAt),
      ...teamExecutions.map(
        (execution) => execution.lastHeartbeatAt ?? execution.completedAt ?? execution.startedAt ?? execution.requestedAt
      )
    ),
    fieldCoverage: {
      title: true,
      objective: Boolean(team.description?.trim()),
      overallStatus: true,
      currentPhase: false,
      ownerTeam: true,
      staffingReadiness: plannedHeadcount > 0,
      topBlockers: true,
      risks: true,
      nextMilestone: false,
      lastUpdated: true,
    },
  };
}

// DASH-64.6: teams now read from the repository. listAccessibleTeamIds
// pulls the user's team set from the cross-workspace SECURITY DEFINER
// helper, then filters by workspace + adds company-tenant teams.
async function listAccessibleTeamIds(
  userId: string,
  workspaceId?: string,
): Promise<Set<string>> {
  const userTeams = await controlPlaneRepository.listAllTeamsForUser(userId);
  const accessibleTeamIds = new Set(
    userTeams
      .filter((team) => matchesWorkspace(team.id, workspaceId))
      .map((team) => team.id),
  );

  const normalizedWorkspaceId = workspaceId?.trim();
  if (!normalizedWorkspaceId) {
    return accessibleTeamIds;
  }

  // DASH-64.7: workspace-scoped company lookup — any user in the
  // workspace can see any team provisioned via a company in that
  // workspace (workspace RLS is the access boundary, NOT
  // company.userId). This mirrors the pre-DASH-64.7 in-memory
  // listAccessibleTeamIds which iterated the global companies Map
  // without user filtering.
  const workspaceCompanies = await controlPlaneRepository.listCompaniesInWorkspace({
    workspaceId: normalizedWorkspaceId,
    userId,
  });
  for (const entry of workspaceCompanies) {
    const tenantWorkspaceId =
      entry.tenantWorkspaceId || companyTenantWorkspaceIds.get(entry.company.id);
    if (tenantWorkspaceId === normalizedWorkspaceId || entry.company.workspaceId === normalizedWorkspaceId) {
      accessibleTeamIds.add(entry.company.teamId);
    }
  }

  return accessibleTeamIds;
}

async function canAccessTeam(
  team: ControlPlaneTeam | undefined,
  userId: string,
  workspaceId?: string,
): Promise<boolean> {
  if (!team) {
    return false;
  }
  return (await listAccessibleTeamIds(userId, workspaceId)).has(team.id);
}

async function canAccessAgent(
  agent: ControlPlaneAgent | undefined,
  userId: string,
  workspaceId?: string,
): Promise<boolean> {
  if (!agent) {
    return false;
  }
  return (await listAccessibleTeamIds(userId, workspaceId)).has(agent.teamId);
}

async function canAccessExecution(
  execution: ControlPlaneExecution | undefined,
  userId: string,
  workspaceId?: string,
): Promise<boolean> {
  if (!execution) {
    return false;
  }
  return (await listAccessibleTeamIds(userId, workspaceId)).has(execution.teamId);
}

// DASH-64.6: getTeamOwnedByUser now async (repo-backed). Resolves via
// the teamWorkspaceIds cache first (still in-memory until DASH-64.8),
// falling back to the cross-workspace helper.
async function getTeamOwnedByUser(
  teamId: string,
  userId: string,
): Promise<ControlPlaneTeam | undefined> {
  const cachedWorkspaceId = teamWorkspaceIds.get(teamId);
  if (cachedWorkspaceId) {
    const team = await controlPlaneRepository.getTeam(
      { workspaceId: cachedWorkspaceId, userId },
      teamId,
    );
    if (team && team.userId === userId) {
      return team;
    }
  }
  const all = await controlPlaneRepository.listAllTeamsForUser(userId);
  return all.find((team) => team.id === teamId);
}

/**
 * DASH-64.5: replaces the synchronous Map lookup. Resolves the agent's
 * team workspace via workspaceContextForTeam — when the team is known
 * (cached or hydrated), the lookup is workspace-scoped and respects
 * RLS. Otherwise we fall back to the cross-workspace helper. Returns
 * undefined if the agent doesn't exist or isn't owned by the caller.
 */
async function getAgentOwnedByUser(
  agentId: string,
  userId: string,
  knownTeamId?: string,
): Promise<ControlPlaneAgent | undefined> {
  if (knownTeamId) {
    const ctx = await workspaceContextForTeam(knownTeamId, userId);
    if (ctx) {
      const agent = await controlPlaneRepository.getAgent(ctx, agentId);
      if (agent && agent.userId === userId) {
        return agent;
      }
    }
  }
  const all = await controlPlaneRepository.listAllAgentsForUser(userId);
  return all.find((agent) => agent.id === agentId);
}

/**
 * DASH-64.4: replaces the synchronous Map lookup. Returns the
 * execution row from the repository if it exists and is owned by the
 * caller. We try the team-resolved workspace context first (cheapest
 * RLS scope); if no team is known (the legacy code path used to
 * bypass team checks for execution lookups), we fall back to the
 * cross-workspace SECURITY DEFINER helper.
 */
async function getExecutionOwnedByUser(
  executionId: string,
  userId: string,
  knownTeamId?: string,
): Promise<ControlPlaneExecution | undefined> {
  if (knownTeamId) {
    const ctx = await workspaceContextForTeam(knownTeamId, userId);
    if (ctx) {
      const execution = await controlPlaneRepository.getExecution(ctx, executionId);
      if (execution && execution.userId === userId) {
        return execution;
      }
    }
  }
  // Cross-workspace lookup (test mode + legacy callers without a team
  // in hand). Production RLS makes the workspace path the common case.
  const all = await controlPlaneRepository.listAllExecutionsForUser(userId);
  return all.find((execution) => execution.id === executionId);
}

// DASH-64.4: hydrateExecution dropped along with the executions Map.
// DASH-64.5: hydrateAgent dropped along with the agents Map.
// DASH-64.6: hydrateTeam dropped along with the teams Map.
// Reading agent_teams / agents / agent_executions now lives entirely
// in controlPlaneRepository (rowToTeam / rowToAgent / rowToExecution).

// DASH-64.7: hydrateProvisionedCompany dropped along with the
// companies Map. rowToProvisionedCompany lives in controlPlaneRepository.

async function ensureWorkspaceHydrated(workspaceId: string | undefined, userId: string): Promise<void> {
  if (!postgresPersistenceAvailable()) {
    return;
  }

  const resolvedWorkspaceId = requireWorkspaceIdForPersistence(workspaceId);
  const cacheKey = workspaceUserKey(resolvedWorkspaceId, userId);
  if (hydratedWorkspaceUsers.has(cacheKey)) {
    return;
  }

  // DASH-64.1: tasks NO LONGER hydrate here — they read live from the
  // repository on every call.
  // DASH-64.2: heartbeats NO LONGER hydrate here either — same pattern.
  // DASH-64.3: spend entries + budget alerts NO LONGER hydrate here
  // either. The hydration was process-restart-survival scaffolding for
  // the in-memory Maps; now reads go straight to the repository, so
  // no hydration step is needed.
  // DASH-64.3: hydratedSpend / hydratedAlerts no longer fetched here.
  await withWorkspaceContext(
    getPostgresPool(),
    { workspaceId: resolvedWorkspaceId, userId },
    async (client) => {
      // DASH-64.4: agent_executions no longer hydrates into an
      // in-memory Map. DASH-64.5: agents same — repo owns reads.
      // DASH-64.6: teams same — repo owns reads. We still SELECT here
      // to populate teamWorkspaceIds + teamCompanyIds derivative
      // indexes (kept until DASH-64.8), but the team row itself is
      // not stored locally.
      const [teamResult, companyResult] = await Promise.all([
        client.query<PersistedTeamRow>(
          `SELECT id, workspace_id, user_id, company_id, name, description, workflow_template_id,
                  workflow_template_name, deployment_mode, status, paused_by_company_lifecycle,
                  restart_count, budget_monthly_usd, tool_budget_ceilings, alert_thresholds,
                  orchestration_enabled, last_heartbeat_at, created_at, updated_at
             FROM agent_teams
            WHERE user_id = $1`,
          [userId]
        ),
        client.query<PersistedProvisionedCompanyRow>(
          `SELECT id, workspace_id, user_id, name, external_company_id,
                  provisioned_workspace_id, provisioned_workspace_name, provisioned_workspace_slug,
                  team_id, idempotency_key, budget_monthly_usd, allocated_budget_monthly_usd,
                  remaining_budget_monthly_usd, created_at, updated_at
             FROM companies
            WHERE user_id = $1`,
          [userId]
        ),
      ]);

      // DASH-64.6: only hydrate the derivative indexes; the team row
      // itself stays in the repo.
      teamResult.rows.forEach((row) => {
        teamWorkspaceIds.set(row.id, row.workspace_id);
        if (row.company_id) {
          teamCompanyIds.set(row.id, row.company_id);
        }
      });
      // DASH-64.7: companies + companyWorkspaces + companyIdempotencyIndex
      // are repository-backed. We still SELECT here only to populate
      // the companyTenantWorkspaceIds derivative index (kept until
      // DASH-64.8).
      companyResult.rows.forEach((row) => {
        companyTenantWorkspaceIds.set(row.id, row.workspace_id);
      });
    }
  );

  // DASH-64.1: hydratedTasks block removed.
  // DASH-64.2: hydratedHeartbeats block removed.
  // DASH-64.3: hydratedSpend + hydratedAlerts blocks removed too.
  // All four entity types (tasks, heartbeats, spend, budget alerts)
  // read live from the repository; no Map hydration needed.

  hydratedWorkspaceUsers.add(cacheKey);
}

// DASH-64.6: upsertTeamRow moved to controlPlaneRepository.
// Store-level callers now invoke
// `controlPlaneRepository.upsertTeam(ctx, team, companyId)` instead.
async function persistTeamViaRepo(team: ControlPlaneTeam, workspaceId: string, userId: string): Promise<void> {
  const companyId = teamCompanyIds.get(team.id) ?? null;
  await controlPlaneRepository.upsertTeam({ workspaceId, userId }, team, companyId);
}

// DASH-64.5: upsertAgentRow moved to controlPlaneRepository.
// Store-level callers now invoke
// `controlPlaneRepository.upsertAgent(ctx, agent)` instead.

// DASH-64.4: upsertExecutionRow moved to controlPlaneRepository.
// Store-level callers (startAgentExecution, finalizeAgentExecution,
// recordHeartbeat, updateAgentLifecycle, updateAgentSkills,
// updateExecutionLifecycle, pauseExecutionForBudget) now invoke
// `controlPlaneRepository.upsertExecution(ctx, execution)` instead.

// DASH-64.7: upsertProvisionedCompanyRow moved to controlPlaneRepository.
// Store-level callers invoke `repo.upsertProvisionedCompany(ctx, ...)`.

// DASH-64.3: spend entries live in the repository now. The team's
// workspace is resolved via the same teamWorkspaceIds cache (or
// lookup_team_workspace_id helper) we use elsewhere. Returns [] when
// the workspace can't be resolved (e.g. tests pre-team-create).
async function listSpendEntriesForPeriod(
  userId: string,
  teamId: string,
  period: string,
): Promise<ControlPlaneSpendEntry[]> {
  const ctx = await workspaceContextForTeam(teamId, userId);
  if (!ctx) return [];
  // Repository takes `since` as ISO; the in-memory fallback compares
  // with string startsWith semantics, so pass the period prefix as
  // a since-floor matching the calendar-month grain we use here.
  const entries = await controlPlaneRepository.listSpendEntries(ctx, {
    teamId,
    since: `${period}-01T00:00:00.000Z`,
  });
  return entries.filter((entry) => entry.recordedAt.startsWith(period));
}

function buildBudgetSnapshot(input: {
  scope: "team" | "agent" | "tool";
  budgetUsd: number;
  spentUsd: number;
  autoPaused: boolean;
  alertThresholds: number[];
}): BudgetStatusSnapshot {
  const roundedSpend = Number(input.spentUsd.toFixed(2));
  const roundedBudget = Number(input.budgetUsd.toFixed(2));
  const remainingUsd = Number(Math.max(0, roundedBudget - roundedSpend).toFixed(2));
  const percentUsed = roundedBudget > 0 ? Number((roundedSpend / roundedBudget).toFixed(4)) : 0;
  const alertThresholdsTriggered = input.alertThresholds
    .filter((threshold) => roundedBudget > 0 && percentUsed >= threshold)
    .sort((left, right) => left - right);

  return {
    scope: input.scope,
    budgetUsd: roundedBudget,
    spentUsd: roundedSpend,
    remainingUsd,
    percentUsed,
    thresholdState: thresholdStateForPercent(percentUsed),
    alertThresholdsTriggered,
    autoPaused: input.autoPaused,
  };
}

// DASH-64.5: agents read via repository. Workspace ctx comes from the
// team mapping (teams still in-memory until DASH-64.6).
async function listAgentsForTeam(
  teamId: string,
  userId: string,
): Promise<ControlPlaneAgent[]> {
  const ctx = await workspaceContextForTeam(teamId, userId);
  if (!ctx) {
    return [];
  }
  const rows = await controlPlaneRepository.listAgents(ctx, { teamId });
  return rows.filter((agent) => agent.userId === userId);
}

// DASH-64.3: now async because both spend entries AND budget alerts
// live in the repository. Every caller awaits.
async function buildTeamSpendSnapshot(team: ControlPlaneTeam): Promise<TeamSpendSnapshot> {
  const period = currentPeriodKey();
  const ctx = await workspaceContextForTeam(team.id, team.userId);

  const entries = ctx
    ? (await controlPlaneRepository.listSpendEntries(ctx, {
        teamId: team.id,
        since: `${period}-01T00:00:00.000Z`,
      })).filter((entry) => entry.recordedAt.startsWith(period))
    : [];

  const alertThresholds = team.alertThresholds.length > 0 ? team.alertThresholds : [0.8, 0.9, 1];
  const teamSpent = entries.reduce((sum, entry) => sum + entry.costUsd, 0);
  const teamSnapshot = buildBudgetSnapshot({
    scope: "team",
    budgetUsd: team.budgetMonthlyUsd,
    spentUsd: teamSpent,
    autoPaused: team.status === "paused" && team.budgetMonthlyUsd > 0 && teamSpent >= team.budgetMonthlyUsd,
    alertThresholds,
  });

  // DASH-64.5: listAgentsForTeam is async now (repo-backed).
  const teamAgentRows = await listAgentsForTeam(team.id, team.userId);
  const agentSnapshots = teamAgentRows.map((agent) => {
    const spentUsd = entries
      .filter((entry) => entry.agentId === agent.id)
      .reduce((sum, entry) => sum + entry.costUsd, 0);
    return {
      agentId: agent.id,
      name: agent.name,
      ...buildBudgetSnapshot({
        scope: "agent",
        budgetUsd: agent.budgetMonthlyUsd,
        spentUsd,
        autoPaused: agent.status === "paused" && agent.budgetMonthlyUsd > 0 && spentUsd >= agent.budgetMonthlyUsd,
        alertThresholds,
      }),
    };
  });

  const toolSnapshots = Object.entries(team.toolBudgetCeilings)
    .map(([toolName, budgetUsd]) => {
      const spentUsd = entries
        .filter((entry) => entry.toolName === toolName)
        .reduce((sum, entry) => sum + entry.costUsd, 0);
      return {
        toolName,
        ...buildBudgetSnapshot({
          scope: "tool",
          budgetUsd,
          spentUsd,
          autoPaused: budgetUsd > 0 && spentUsd >= budgetUsd,
          alertThresholds,
        }),
      };
    })
    .sort((left, right) => left.toolName.localeCompare(right.toolName));

  const totalsByCategory = entries.reduce<Partial<Record<SpendCategory, number>>>((totals, entry) => {
    totals[entry.category] = Number((((totals[entry.category] ?? 0) + entry.costUsd)).toFixed(2));
    return totals;
  }, {});

  const alerts = ctx
    ? (await controlPlaneRepository.listBudgetAlerts(ctx, { teamId: team.id }))
        .filter((alert) => alert.recordedAt.startsWith(period))
        .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt))
    : [];

  return {
    period,
    team: teamSnapshot,
    agents: agentSnapshots,
    tools: toolSnapshots,
    alerts,
    totalsByCategory,
  };
}

async function upsertBudgetAlert(input: {
  team: ControlPlaneTeam;
  threshold: number;
  scope: "team" | "agent" | "tool";
  spentUsd: number;
  budgetUsd: number;
  agentId?: string;
  toolName?: string;
}): Promise<void> {
  if (input.budgetUsd <= 0 || input.spentUsd / input.budgetUsd < input.threshold) {
    return;
  }

  // DASH-64.3 (Codex pattern from iter 2 + 4): repository owns the
  // dedupe contract via Postgres ON CONFLICT (partial unique indexes
  // on scope/agent_id/tool_name/threshold). The pre-DASH-64.3 inline
  // `budgetAlerts.has(dedupeKey)` check is gone — concurrent threshold
  // crossings now converge atomically at the DB layer (or the in-
  // memory fallback's match-by-scope-key, see
  // controlPlaneRepository.upsertBudgetAlert).
  const alert: ControlPlaneBudgetAlert = {
    id: randomUUID(),
    userId: input.team.userId,
    teamId: input.team.id,
    agentId: input.agentId,
    toolName: input.toolName,
    scope: input.scope,
    threshold: input.threshold,
    budgetUsd: Number(input.budgetUsd.toFixed(2)),
    spentUsd: Number(input.spentUsd.toFixed(2)),
    recordedAt: nowIso(),
  };

  // DASH-64.3 iter 2 (mirrors Codex P1 on #901): throw instead of
  // silently dropping the alert when workspaceContextForTeam returns
  // undefined. A missing budget alert can mask real overspend.
  const ctx = await workspaceContextForTeam(input.team.id, input.team.userId);
  if (!ctx) {
    throw new Error("budget_alert_workspace_unresolved");
  }
  await controlPlaneRepository.upsertBudgetAlert(ctx, alert);
}

async function pauseExecutionForBudget(
  team: ControlPlaneTeam,
  agentId: string,
  executionId?: string,
): Promise<void> {
  const timestamp = nowIso();
  if (executionId) {
    // DASH-64.4: execution now read+written via repository instead of
    // the in-memory Map.
    //
    // DASH-64.4 iter 2 (mirrors Codex P1 on #901): throw instead of
    // silently skipping the pause when workspaceContextForTeam returns
    // undefined. A skipped pause-for-budget means runaway compute
    // beyond the budget cap.
    const ctx = await workspaceContextForTeam(team.id, team.userId);
    if (!ctx) {
      throw new Error("pause_execution_workspace_unresolved");
    }
    const execution = await controlPlaneRepository.getExecution(ctx, executionId);
    if (execution && execution.status === "running") {
      const updated: ControlPlaneExecution = {
        ...execution,
        status: "blocked",
        summary: execution.summary ?? "Execution halted after budget limit was reached.",
        completedAt: timestamp,
        lastHeartbeatAt: timestamp,
      };
      await controlPlaneRepository.upsertExecution(ctx, updated);
    }
  }

  // DASH-64.5: agent now read+written via repository. Same iter-2
  // hardening: throw on unresolved ctx.
  const agentCtx = await workspaceContextForTeam(team.id, team.userId);
  if (!agentCtx) {
    throw new Error("pause_execution_workspace_unresolved");
  }
  const agent = await controlPlaneRepository.getAgent(agentCtx, agentId);
  if (agent) {
    const updatedAgent: ControlPlaneAgent = {
      ...agent,
      currentExecutionId: undefined,
      lastHeartbeatAt: timestamp,
      lastHeartbeatStatus: "blocked",
      updatedAt: timestamp,
      status: "paused",
    };
    await controlPlaneRepository.upsertAgent(agentCtx, updatedAgent);
  }
}

async function applyBudgetPolicies(team: ControlPlaneTeam, agentId: string, executionId?: string): Promise<void> {
  // DASH-64.3: buildTeamSpendSnapshot is now async.
  const snapshot = await buildTeamSpendSnapshot(team);
  const agentSnapshot = snapshot.agents.find((entry) => entry.agentId === agentId);

  for (const threshold of snapshot.team.alertThresholdsTriggered) {
    await upsertBudgetAlert({
      team,
      threshold,
      scope: "team",
      spentUsd: snapshot.team.spentUsd,
      budgetUsd: snapshot.team.budgetUsd,
    });
  }
  if (agentSnapshot) {
    for (const threshold of agentSnapshot.alertThresholdsTriggered) {
      await upsertBudgetAlert({
        team,
        threshold,
        scope: "agent",
        agentId,
        spentUsd: agentSnapshot.spentUsd,
        budgetUsd: agentSnapshot.budgetUsd,
      });
    }
  }
  for (const toolSnapshot of snapshot.tools) {
    for (const threshold of toolSnapshot.alertThresholdsTriggered) {
      await upsertBudgetAlert({
        team,
        threshold,
        scope: "tool",
        toolName: toolSnapshot.toolName,
        spentUsd: toolSnapshot.spentUsd,
        budgetUsd: toolSnapshot.budgetUsd,
        agentId,
      });
    }
  }

  if (snapshot.team.budgetUsd > 0 && snapshot.team.spentUsd >= snapshot.team.budgetUsd) {
    team.status = "paused";
    team.updatedAt = nowIso();
    // DASH-64.5: listAgentsForTeam is async (repo-backed). Each agent
    // mutator routes through repo.upsertAgent — iter-2 hardening:
    // throw on unresolved workspace ctx.
    const policiesCtx = await workspaceContextForTeam(team.id, team.userId);
    if (!policiesCtx) {
      throw new Error("budget_policies_workspace_unresolved");
    }
    // DASH-64.6: persist team status via repo.
    await controlPlaneRepository.upsertTeam(policiesCtx, team, teamCompanyIds.get(team.id) ?? null);
    const teamAgents = await listAgentsForTeam(team.id, team.userId);
    for (const teamAgent of teamAgents) {
      if (teamAgent.status === "active") {
        if (teamAgent.id === agentId) {
          // DASH-64.4: pauseExecutionForBudget is now async (repo-backed
          // for both execution and agent).
          await pauseExecutionForBudget(team, teamAgent.id, executionId);
        } else {
          const updated: ControlPlaneAgent = {
            ...teamAgent,
            status: "paused",
            updatedAt: nowIso(),
          };
          await controlPlaneRepository.upsertAgent(policiesCtx, updated);
        }
      }
    }
    return;
  }

  if (agentSnapshot && agentSnapshot.budgetUsd > 0 && agentSnapshot.spentUsd >= agentSnapshot.budgetUsd) {
    await pauseExecutionForBudget(team, agentId, executionId);
  }

  if (snapshot.tools.some((toolSnapshot) => toolSnapshot.budgetUsd > 0 && toolSnapshot.spentUsd >= toolSnapshot.budgetUsd)) {
    await pauseExecutionForBudget(team, agentId, executionId);
  }
}

async function assertExecutionAllowed(team: ControlPlaneTeam, agent: ControlPlaneAgent): Promise<void> {
  // DASH-64.3: buildTeamSpendSnapshot is now async.
  const snapshot = await buildTeamSpendSnapshot(team);
  const agentSnapshot = snapshot.agents.find((entry) => entry.agentId === agent.id);

  if (snapshot.team.budgetUsd > 0 && snapshot.team.spentUsd >= snapshot.team.budgetUsd) {
    team.status = "paused";
    // DASH-64.6: persist team status via repo (iter-2 hardened).
    const assertTeamCtx = await workspaceContextForTeam(team.id, team.userId);
    if (!assertTeamCtx) {
      throw new Error("assert_execution_workspace_unresolved");
    }
    await controlPlaneRepository.upsertTeam(assertTeamCtx, team, teamCompanyIds.get(team.id) ?? null);
    throw new Error("team_budget_exceeded");
  }

  if (agentSnapshot && agentSnapshot.budgetUsd > 0 && agentSnapshot.spentUsd >= agentSnapshot.budgetUsd) {
    agent.status = "paused";
    // DASH-64.5: persist agent status via repo (iter-2 hardened).
    const assertCtx = await workspaceContextForTeam(team.id, team.userId);
    if (!assertCtx) {
      throw new Error("assert_execution_workspace_unresolved");
    }
    await controlPlaneRepository.upsertAgent(assertCtx, agent);
    throw new Error("agent_budget_exceeded");
  }
}

/**
 * DASH-64.6: builds a team record without persisting it. The legacy
 * `persist = true` branch wrote to the in-memory `teams` Map; with
 * that Map gone, callers explicitly persist via
 * `controlPlaneRepository.upsertTeam(ctx, team)` once they have a
 * workspace context.
 */
function createTeamRecord(input: {
  workspaceId?: string;
  userId: string;
  name: string;
  description?: string;
  workflowTemplateId?: string;
  workflowTemplateName?: string;
  deploymentMode?: ControlPlaneTeam["deploymentMode"];
  budgetMonthlyUsd?: number;
  toolBudgetCeilings?: Record<string, number>;
  alertThresholds?: number[];
  orchestrationEnabled?: boolean;
}): ControlPlaneTeam {
  const timestamp = nowIso();
  const team: ControlPlaneTeam = {
    id: randomUUID(),
    userId: input.userId,
    name: input.name,
    description: input.description,
    workflowTemplateId: input.workflowTemplateId,
    workflowTemplateName: input.workflowTemplateName,
    deploymentMode: input.deploymentMode ?? "workflow_runtime",
    status: "active",
    restartCount: 0,
    budgetMonthlyUsd: input.budgetMonthlyUsd ?? 0,
    toolBudgetCeilings: { ...(input.toolBudgetCeilings ?? {}) },
    alertThresholds: input.alertThresholds?.length ? [...input.alertThresholds].sort((a, b) => a - b) : [0.8, 0.9, 1],
    orchestrationEnabled: input.orchestrationEnabled ?? true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  if (input.workspaceId) {
    teamWorkspaceIds.set(team.id, input.workspaceId);
  }
  return team;
}

/**
 * DASH-64.5: builds an agent record without persisting it. The legacy
 * `persist = true` branch wrote to the in-memory `agents` Map; with
 * that Map gone, callers explicitly persist via
 * `controlPlaneRepository.upsertAgent(ctx, agent)` once they have a
 * workspace context. This matches the pre-DASH-64.5 `persist = false`
 * callers (provisionCompanyWorkspace) — now the only flow.
 */
function createAgentRecord(
  input: Omit<ControlPlaneAgent, "id" | "createdAt" | "updatedAt">,
): ControlPlaneAgent {
  const timestamp = nowIso();
  return {
    ...input,
    skills: [...input.skills],
    id: randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function provisionStepAgent(input: {
  teamId: string;
  userId: string;
  step: WorkflowStep;
  budgetMonthlyUsd: number;
  reportingToAgentId?: string;
  defaultIntervalMinutes?: number;
  index?: number;
}): ControlPlaneAgent {
  return createAgentRecord({
    teamId: input.teamId,
    userId: input.userId,
    name: input.step.name,
    roleKey: inferRoleKey(input.step, input.index),
    workflowStepId: input.step.id,
    workflowStepKind: input.step.kind,
    model: input.step.agentModel ?? input.step.llmConfigId,
    instructions:
      input.step.agentInstructions ??
      input.step.description ??
      `Execute the ${input.step.kind} step ${input.step.name}.`,
    budgetMonthlyUsd: input.step.agentBudgetMonthlyUsd ?? input.budgetMonthlyUsd,
    reportingToAgentId: input.reportingToAgentId,
    skills: inferSkills(input.step),
    schedule:
      input.defaultIntervalMinutes && input.defaultIntervalMinutes > 0
        ? { type: "interval", intervalMinutes: input.defaultIntervalMinutes }
        : { type: "manual" },
    status: "active",
  });
}

// DASH-64.5: agents read via repository.
async function getAgentForWorkflowStep(
  teamId: string,
  userId: string,
  step: WorkflowStep,
): Promise<ControlPlaneAgent | undefined> {
  const requestedRoleKey = inferRoleKey(step);
  const teamAgents = await listAgentsForTeam(teamId, userId);
  return teamAgents.find(
    (agent) => agent.workflowStepId === step.id || agent.roleKey === requestedRoleKey,
  );
}

function wasExecutionRequestedBeforePause(requestedAt: string, pausedAt?: string): boolean {
  if (!pausedAt) {
    return true;
  }
  return new Date(requestedAt).getTime() <= new Date(pausedAt).getTime();
}
export const controlPlaneStore = {
  async ensureWorkspaceHydrated(workspaceId: string | undefined, userId: string): Promise<void> {
    await ensureWorkspaceHydrated(workspaceId, userId);
  },

  listSkills(): ControlPlaneSkillDefinition[] {
    return SKILL_CATALOG.map((skill) => ({ ...skill }));
  },

  listRoleTemplates(): ControlPlaneRoleTemplateDefinition[] {
    return ROLE_TEMPLATE_CATALOG.map((template) => ({
      ...template,
      defaultSkills: [...template.defaultSkills],
    }));
  },

  async provisionCompanyWorkspace(input: {
    workspaceId?: string;
    userId: string;
    name: string;
    workspaceName?: string;
    externalCompanyId?: string;
    idempotencyKey: string;
    budgetMonthlyUsd: number;
    orchestrationEnabled?: boolean;
    secretBindings: Record<string, string>;
    agents: CompanyProvisioningAgentInput[];
  }): Promise<CompanyProvisioningResult> {
    await ensureWorkspaceHydrated(input.workspaceId, input.userId);
    const normalizedName = input.name.trim();
    const normalizedWorkspaceName = input.workspaceName?.trim() || `${normalizedName} Workspace`;
    const normalizedIdempotencyKey = input.idempotencyKey.trim();
    const normalizedExternalCompanyId = input.externalCompanyId?.trim() || undefined;
    const fingerprint = serializeProvisioningFingerprint({
      name: normalizedName,
      workspaceName: normalizedWorkspaceName,
      externalCompanyId: normalizedExternalCompanyId,
      budgetMonthlyUsd: input.budgetMonthlyUsd,
      orchestrationEnabled: input.orchestrationEnabled,
      secretBindings: input.secretBindings,
      agents: input.agents,
    });
    // DASH-64.7: companyIdempotencyIndex is now derivable — scan the
    // user's companies for a matching idempotencyKey. Fingerprint
    // tracking moved into the repository's MemCompanyEntry.
    const userCompanies = await controlPlaneRepository.listAllProvisionedCompaniesForUser(input.userId);
    const existingEntry = userCompanies.find(
      (entry) => entry.company.idempotencyKey === normalizedIdempotencyKey,
    );
    if (existingEntry) {
      if (existingEntry.fingerprint && existingEntry.fingerprint !== fingerprint) {
        throw new Error("idempotency_conflict");
      }

      const company = existingEntry.company;
      const workspace = existingEntry.workspace;
      // DASH-64.6: getTeamOwnedByUser is async now (repo-backed).
      const team = await getTeamOwnedByUser(company.teamId, input.userId);
      if (!team) {
        throw new Error("idempotency_target_missing");
      }

      const replaySummaries = postgresPersistenceAvailable()
        ? await secretsRepository.listSecretSummaries(
            {
              workspaceId: requireWorkspaceIdForPersistence(input.workspaceId),
              userId: input.userId,
              actorUserId: input.userId,
            },
            company.id
          )
        : buildCompanySecretSummaries(existingEntry.secretBindings);

      return {
        company: { ...company },
        workspace: { ...workspace },
        team: { ...team },
        agents: await this.listAgents(team.id, input.userId),
        secretBindings: replaySummaries,
        availableSkills: this.listSkills(),
        idempotentReplay: true,
      };
    }

    const roleTemplateUsage = new Map<string, number>();
    const resolvedRoleTemplates = input.agents.map((agentInput) => {
      const roleTemplate = getRoleTemplateById(agentInput.roleTemplateId);
      if (!roleTemplate) {
        throw new Error(`unknown_role_template:${agentInput.roleTemplateId}`);
      }
      if (agentInput.skills) {
        ensureValidSkillIds(agentInput.skills);
      }
      return roleTemplate;
    });
    const explicitBudget = input.agents.reduce((sum, agent) => sum + (agent.budgetMonthlyUsd ?? 0), 0);
    if (explicitBudget > input.budgetMonthlyUsd) {
      throw new Error("budget_exceeded");
    }
    const agentsWithoutBudget = input.agents.filter((agent) => agent.budgetMonthlyUsd === undefined);
    const remainingBudgetPool = Number((input.budgetMonthlyUsd - explicitBudget).toFixed(2));
    const perAgentBudget =
      agentsWithoutBudget.length > 0
        ? Number((remainingBudgetPool / agentsWithoutBudget.length).toFixed(2))
        : 0;

    const team = createTeamRecord({
      workspaceId: input.workspaceId,
      userId: input.userId,
      name: normalizedWorkspaceName,
      description: `Provisioned company workspace for ${normalizedName}`,
      deploymentMode: "continuous_agents",
      budgetMonthlyUsd: input.budgetMonthlyUsd,
      orchestrationEnabled: input.orchestrationEnabled ?? true,
    });

    const provisionedAgents = input.agents.map((agentInput, index) => {
      const roleTemplate = resolvedRoleTemplates[index];
      const usageCount = roleTemplateUsage.get(roleTemplate.id) ?? 0;
      roleTemplateUsage.set(roleTemplate.id, usageCount + 1);
      return createAgentRecord({
        teamId: team.id,
        userId: input.userId,
        name: agentInput.name?.trim() || roleTemplate.name,
        roleKey: makeProvisioningRoleKey(roleTemplate.id, usageCount),
        model: agentInput.model?.trim() || roleTemplate.defaultModel,
        instructions: agentInput.instructions?.trim() || roleTemplate.defaultInstructions,
        budgetMonthlyUsd:
          agentInput.budgetMonthlyUsd !== undefined ? agentInput.budgetMonthlyUsd : perAgentBudget,
        reportingToAgentId: undefined,
        skills: mergeSkills(roleTemplate.defaultSkills, agentInput.skills),
        schedule: { type: "manual" },
        status: "active",
      });
    });

    const allocatedBudgetMonthlyUsd = Number(
      provisionedAgents.reduce((sum, agent) => sum + agent.budgetMonthlyUsd, 0).toFixed(2)
    );
    if (allocatedBudgetMonthlyUsd > input.budgetMonthlyUsd) {
      throw new Error("budget_exceeded");
    }

    const timestamp = nowIso();
    const workspaceId = input.workspaceId?.trim() || randomUUID();
    // DASH-64.7: companyWorkspaces is repo-backed. We need the
    // existing workspace's createdAt to preserve it on re-provisioning;
    // look it up by scanning the user's companies.
    const existingWorkspaceEntry = userCompanies.find(
      (entry) => entry.workspace.id === workspaceId,
    );
    const workspace: ProvisionedCompanyWorkspace = {
      id: workspaceId,
      name: normalizedWorkspaceName,
      slug: slugify(normalizedName),
      createdAt: existingWorkspaceEntry?.workspace.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    const company: ProvisionedCompanyRecord = {
      id: randomUUID(),
      userId: input.userId,
      name: normalizedName,
      externalCompanyId: normalizedExternalCompanyId,
      workspaceId: workspace.id,
      teamId: team.id,
      idempotencyKey: normalizedIdempotencyKey,
      budgetMonthlyUsd: input.budgetMonthlyUsd,
      allocatedBudgetMonthlyUsd,
      remainingBudgetMonthlyUsd: Number((input.budgetMonthlyUsd - allocatedBudgetMonthlyUsd).toFixed(2)),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    teamCompanyIds.set(team.id, company.id);

    // DASH-64.5: agents persist via repository (test in-mem bucket OR
    // production Postgres path both handled there). Iter-2 hardening:
    // throw on unresolved workspace ctx instead of silently dropping.
    // DASH-64.6: team persists via repository too.
    // DASH-64.7: company suite (company + workspace + idempotency
    // fingerprint + test-mode secretBindings) persists via repository.
    const provisionCtx = await workspaceContextForTeam(team.id, input.userId);
    if (!provisionCtx) {
      throw new Error("agent_provision_workspace_unresolved");
    }
    await controlPlaneRepository.upsertTeam(provisionCtx, team, company.id);
    for (const agent of provisionedAgents) {
      await controlPlaneRepository.upsertAgent(provisionCtx, agent);
    }
    // DASH-64.7: company suite write goes through the repo. tenantWorkspaceId
    // is the canonical workspace this tenant belongs to (provisionCtx).
    // In test mode this also stores the fingerprint + secretBindings so the
    // idempotency-replay path can find them on a second call.
    companyTenantWorkspaceIds.set(company.id, provisionCtx.workspaceId);
    await controlPlaneRepository.upsertProvisionedCompany(provisionCtx, {
      company,
      workspace,
      tenantWorkspaceId: provisionCtx.workspaceId,
      fingerprint,
      secretBindings: !postgresPersistenceAvailable() ? input.secretBindings : undefined,
    });

    if (postgresPersistenceAvailable()) {
      const workspaceId = requireWorkspaceIdForPersistence(input.workspaceId);
      await secretsRepository.setSecrets(
        { workspaceId, userId: input.userId, actorUserId: input.userId },
        company.id,
        input.secretBindings
      );
      hydratedWorkspaceUsers.add(workspaceUserKey(workspaceId, input.userId));
    }

    return {
      company: { ...company },
      workspace: { ...workspace },
      team: { ...team },
      agents: provisionedAgents.map((agent) => ({ ...agent, skills: [...agent.skills] })),
      secretBindings: buildCompanySecretSummaries(input.secretBindings),
      availableSkills: this.listSkills(),
      idempotentReplay: false,
    };
  },

  async createTeam(input: {
    workspaceId?: string;
    userId: string;
    name: string;
    description?: string;
    workflowTemplateId?: string;
    workflowTemplateName?: string;
    deploymentMode?: ControlPlaneTeam["deploymentMode"];
    budgetMonthlyUsd?: number;
    toolBudgetCeilings?: Record<string, number>;
    alertThresholds?: number[];
    orchestrationEnabled?: boolean;
  }): Promise<ControlPlaneTeam> {
    await ensureWorkspaceHydrated(input.workspaceId, input.userId);
    const team = createTeamRecord(input);
    // DASH-64.6: team persists via repo. Iter-2 hardening: throw on
    // unresolved workspace ctx.
    const createCtx = await workspaceContextForTeam(team.id, input.userId);
    if (!createCtx) {
      throw new Error("team_create_workspace_unresolved");
    }
    await controlPlaneRepository.upsertTeam(createCtx, team, teamCompanyIds.get(team.id) ?? null);
    if (postgresPersistenceAvailable() && input.workspaceId) {
      hydratedWorkspaceUsers.add(workspaceUserKey(input.workspaceId, input.userId));
    }
    return team;
  },

  // DASH-64.6: listTeams is now async — repository-backed.
  async listTeams(
    userId: string,
    workspaceId?: string,
  ): Promise<ControlPlaneTeam[]> {
    const accessibleTeamIds = await listAccessibleTeamIds(userId, workspaceId);
    if (workspaceId) {
      const rows = await controlPlaneRepository.listTeams({ workspaceId, userId });
      return rows.filter((team) => accessibleTeamIds.has(team.id));
    }
    const rows = await controlPlaneRepository.listAllTeamsForUser(userId);
    return rows.filter((team) => accessibleTeamIds.has(team.id));
  },

  // DASH-64.6: getTeam is now async — repository-backed.
  async getTeam(
    teamId: string,
    userId: string,
    workspaceId?: string,
  ): Promise<ControlPlaneTeam | undefined> {
    let team: ControlPlaneTeam | undefined;
    if (workspaceId) {
      team = await controlPlaneRepository.getTeam({ workspaceId, userId }, teamId);
    } else {
      const cachedWorkspaceId = teamWorkspaceIds.get(teamId);
      if (cachedWorkspaceId) {
        team = await controlPlaneRepository.getTeam(
          { workspaceId: cachedWorkspaceId, userId },
          teamId,
        );
      }
      if (!team) {
        const all = await controlPlaneRepository.listAllTeamsForUser(userId);
        team = all.find((candidate) => candidate.id === teamId);
      }
    }
    return (await canAccessTeam(team, userId, workspaceId)) ? team : undefined;
  },

  // DASH-64.1: now async because buildMissionState reads tasks from the
  // repository (Postgres-first). Every caller updated to await.
  async getMissionState(teamId: string, userId: string, workspaceId?: string): Promise<ControlPlaneMissionState | undefined> {
    // DASH-64.6: team read via repository; canAccessTeam is async.
    const team = await this.getTeam(teamId, userId, workspaceId);
    if (!team) {
      return undefined;
    }
    return buildMissionState(team);
  },

  // DASH-64.5: listAgents is now async — repository-backed. The
  // access boundary is workspace membership (canAccessTeam), NOT the
  // agent's userId — pre-DASH-64.5 also did NOT filter by agent.userId,
  // so a second identity in the same workspace could see provisioned
  // agents even when they were created under a different user.
  async listAgents(
    teamId: string,
    userId: string,
    workspaceId?: string,
  ): Promise<ControlPlaneAgent[]> {
    // DASH-64.6: team read via repository; canAccessTeam is async.
    const team = await this.getTeam(teamId, userId, workspaceId);
    if (!team) {
      return [];
    }
    let resolvedWorkspaceId = workspaceId;
    if (!resolvedWorkspaceId) {
      const teamCtx = await workspaceContextForTeam(teamId, userId);
      resolvedWorkspaceId = teamCtx?.workspaceId;
    }
    if (!resolvedWorkspaceId) {
      return [];
    }
    return controlPlaneRepository.listAgents(
      { workspaceId: resolvedWorkspaceId, userId },
      { teamId },
    );
  },

  // DASH-64.5: listAllAgents is now async — repository-backed.
  // DASH-64.6: listAccessibleTeamIds is now async too.
  async listAllAgents(
    userId: string,
    workspaceId?: string,
  ): Promise<ControlPlaneAgent[]> {
    const accessibleTeamIds = await listAccessibleTeamIds(userId, workspaceId);
    if (workspaceId) {
      const rows = await controlPlaneRepository.listAgents(
        { workspaceId, userId },
      );
      return rows.filter((agent) => accessibleTeamIds.has(agent.teamId));
    }
    const rows = await controlPlaneRepository.listAllAgentsForUser(userId);
    return rows.filter((agent) => accessibleTeamIds.has(agent.teamId));
  },

  // DASH-64.5: getAgent is now async — repository-backed.
  // DASH-64.6: canAccessAgent is now async too.
  async getAgent(
    agentId: string,
    userId: string,
    workspaceId?: string,
  ): Promise<ControlPlaneAgent | undefined> {
    if (workspaceId) {
      const agent = await controlPlaneRepository.getAgent({ workspaceId, userId }, agentId);
      return (await canAccessAgent(agent, userId, workspaceId)) ? agent : undefined;
    }
    // No workspace pinned — use the cross-workspace fallback.
    const all = await controlPlaneRepository.listAllAgentsForUser(userId);
    const agent = all.find((candidate) => candidate.id === agentId);
    return (await canAccessAgent(agent, userId, workspaceId)) ? agent : undefined;
  },

  // DASH-64.4: listExecutions is now async — repository-backed.
  // DASH-64.6: listAccessibleTeamIds is now async too.
  async listExecutions(
    userId: string,
    teamId?: string,
    workspaceId?: string,
  ): Promise<ControlPlaneExecution[]> {
    const accessibleTeamIds = await listAccessibleTeamIds(userId, workspaceId);
    // Prefer the workspace-scoped repository read when a workspace is
    // resolved (production RLS path). Otherwise fall back to the
    // SECURITY DEFINER helper for cross-workspace observability.
    if (workspaceId) {
      const rows = await controlPlaneRepository.listExecutions(
        { workspaceId, userId },
        teamId ? { teamId } : undefined,
      );
      return rows.filter((execution) => accessibleTeamIds.has(execution.teamId));
    }
    const rows = await controlPlaneRepository.listAllExecutionsForUser(userId);
    return rows.filter(
      (execution) =>
        accessibleTeamIds.has(execution.teamId) && (!teamId || execution.teamId === teamId),
    );
  },

  // DASH-64.4: listAgentExecutions is now async — repository-backed.
  // DASH-64.5: agent existence check now goes through repo too.
  async listAgentExecutions(
    agentId: string,
    userId: string,
    workspaceId?: string,
  ): Promise<ControlPlaneExecution[]> {
    const agent = await this.getAgent(agentId, userId, workspaceId);
    // DASH-64.6: canAccessAgent is async now; this.getAgent already
    // applied the access check, so a non-undefined agent means we're
    // good.
    if (!agent) {
      return [];
    }
    let resolvedWorkspaceId = workspaceId;
    if (!resolvedWorkspaceId && agent) {
      const teamCtx = await workspaceContextForTeam(agent.teamId, userId);
      resolvedWorkspaceId = teamCtx?.workspaceId;
    }
    if (resolvedWorkspaceId) {
      return controlPlaneRepository.listExecutions(
        { workspaceId: resolvedWorkspaceId, userId },
        { agentId },
      );
    }
    const rows = await controlPlaneRepository.listAllExecutionsForUser(userId);
    return rows.filter((execution) => execution.agentId === agentId);
  },

  // DASH-64.2: now async — repository-backed.
  // DASH-64.5: agent existence check goes through repo too.
  async listAgentHeartbeats(
    agentId: string,
    userId: string,
    workspaceId?: string,
  ): Promise<AgentHeartbeatRecord[]> {
    const agent = await this.getAgent(agentId, userId, workspaceId);
    // DASH-64.6: getAgent already applied the access check.
    if (!agent) {
      return [];
    }
    // DASH-64.2 hotfix (Codex on #902): resolve workspace via the
    // agent's team before falling back to the cross-workspace helper.
    let resolvedWorkspaceId = workspaceId;
    if (!resolvedWorkspaceId && agent) {
      const teamCtx = await workspaceContextForTeam(agent.teamId, userId);
      resolvedWorkspaceId = teamCtx?.workspaceId;
    }
    const rows: AgentHeartbeatRecord[] = resolvedWorkspaceId
      ? await controlPlaneRepository.listHeartbeats(
          { workspaceId: resolvedWorkspaceId, userId },
          { agentId },
        )
      : (await controlPlaneRepository.listAllHeartbeatsForUser(userId)).filter(
          (heartbeat) => heartbeat.agentId === agentId,
        );
    return rows
      .filter((heartbeat) => heartbeat.agentId === agentId)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  },

  // DASH-64.3: now async — repository-backed. teamId is required to
  // resolve the workspace context; without one the result is empty
  // (legacy behaviour: cross-workspace spend listing isn't exposed).
  async listSpendEntries(
    userId: string,
    filters?: {
      teamId?: string;
      agentId?: string;
      executionId?: string;
      period?: string;
    },
  ): Promise<ControlPlaneSpendEntry[]> {
    if (!filters?.teamId) return [];
    const ctx = await workspaceContextForTeam(filters.teamId, userId);
    if (!ctx) return [];
    const rows = await controlPlaneRepository.listSpendEntries(ctx, {
      teamId: filters.teamId,
      agentId: filters.agentId,
    });
    return rows
      .filter((entry) => {
        if (filters.executionId && entry.executionId !== filters.executionId) return false;
        if (filters.period && !entry.recordedAt.startsWith(filters.period)) return false;
        return true;
      })
      .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  },

  // DASH-64.3: now async — repository-backed. teamId required to
  // resolve the workspace context.
  async listBudgetAlerts(userId: string, teamId?: string): Promise<ControlPlaneBudgetAlert[]> {
    if (!teamId) return [];
    const ctx = await workspaceContextForTeam(teamId, userId);
    if (!ctx) return [];
    const rows = await controlPlaneRepository.listBudgetAlerts(ctx, { teamId });
    return rows.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  },

  // DASH-64.3: now async because buildTeamSpendSnapshot reads spend
  // entries + budget alerts from the repository.
  async getTeamSpendSnapshot(
    teamId: string,
    userId: string,
    workspaceId?: string,
  ): Promise<TeamSpendSnapshot | undefined> {
    // DASH-64.6: team read via repository; access check is async.
    const team = await this.getTeam(teamId, userId, workspaceId);
    if (!team) {
      return undefined;
    }
    return buildTeamSpendSnapshot(team);
  },

  async deployWorkflowAsTeam(input: {
    workspaceId?: string;
    userId: string;
    template: WorkflowTemplate;
    teamName?: string;
    budgetMonthlyUsd?: number;
    toolBudgetCeilings?: Record<string, number>;
    alertThresholds?: number[];
    defaultIntervalMinutes?: number;
  }): Promise<ControlPlaneDeployment> {
    await ensureWorkspaceHydrated(input.workspaceId, input.userId);
    const actionableSteps = input.template.steps.filter(
      (step) => !["trigger", "cron_trigger", "interval_trigger", "output"].includes(step.kind)
    );
    const teamBudget = input.budgetMonthlyUsd ?? 0;
    const team = createTeamRecord({
      workspaceId: input.workspaceId,
      userId: input.userId,
      name: input.teamName?.trim() || `${input.template.name} Control Plane`,
      description: `Agent team deployed from workflow template ${input.template.name}`,
      workflowTemplateId: input.template.id,
      workflowTemplateName: input.template.name,
      deploymentMode: "continuous_agents",
      budgetMonthlyUsd: teamBudget,
      toolBudgetCeilings: input.toolBudgetCeilings,
      alertThresholds: input.alertThresholds,
      orchestrationEnabled: true,
    });

    const managerBudget = teamBudget > 0 ? Number((teamBudget * 0.2).toFixed(2)) : 0;
    const workerBudgetPool = Math.max(0, teamBudget - managerBudget);
    const perWorkerBudget =
      actionableSteps.length > 0 ? Number((workerBudgetPool / actionableSteps.length).toFixed(2)) : 0;

    // DASH-64.5: collect agents into a local list (previously persisted
    // straight to the `agents` Map via createAgentRecord). Then persist
    // each via repo.upsertAgent (in-memory bucket in test, Postgres in
    // prod).
    const provisionedAgents: ControlPlaneAgent[] = [];
    const manager = createAgentRecord({
      teamId: team.id,
      userId: input.userId,
      name: `${input.template.name} Manager`,
      roleKey: "workflow-manager",
      instructions: `Coordinate the deployed workflow ${input.template.name}, manage task handoffs, and maintain the audit trail.`,
      budgetMonthlyUsd: managerBudget,
      reportingToAgentId: undefined,
      skills: ["paperclip"],
      schedule: { type: "manual" },
      status: "active",
    });
    provisionedAgents.push(manager);

    actionableSteps.forEach((step, index) => {
      provisionedAgents.push(
        provisionStepAgent({
          teamId: team.id,
          userId: input.userId,
          step,
          budgetMonthlyUsd: perWorkerBudget,
          reportingToAgentId: manager.id,
          defaultIntervalMinutes: input.defaultIntervalMinutes,
          index,
        }),
      );
    });

    if (actionableSteps.length === 0) {
      provisionedAgents.push(
        createAgentRecord({
          teamId: team.id,
          userId: input.userId,
          name: "General Operator",
          roleKey: "general-operator",
          instructions: `Execute operational work for ${input.template.name} when no step-specific agent mapping exists.`,
          budgetMonthlyUsd: workerBudgetPool,
          reportingToAgentId: manager.id,
          skills: ["paperclip"],
          schedule:
            input.defaultIntervalMinutes && input.defaultIntervalMinutes > 0
              ? { type: "interval", intervalMinutes: input.defaultIntervalMinutes }
              : { type: "manual" },
          status: "active",
        }),
      );
    }

    // DASH-64.5: persist agents via repo (iter-2 hardening: throw on
    // unresolved ctx instead of silently dropping).
    // DASH-64.6: team also persists via repo.
    const deployCtx = await workspaceContextForTeam(team.id, input.userId);
    if (!deployCtx) {
      throw new Error("agent_provision_workspace_unresolved");
    }
    await controlPlaneRepository.upsertTeam(deployCtx, team, teamCompanyIds.get(team.id) ?? null);
    for (const agent of provisionedAgents) {
      await controlPlaneRepository.upsertAgent(deployCtx, agent);
    }

    if (postgresPersistenceAvailable() && input.workspaceId) {
      hydratedWorkspaceUsers.add(workspaceUserKey(input.workspaceId, input.userId));
    }

    return {
      team,
      agents: await this.listAgents(team.id, input.userId),
      workflow: {
        id: input.template.id,
        name: input.template.name,
        category: input.template.category,
        version: input.template.version,
      },
      availableSkills: this.listSkills(),
    };
  },

  async ensureRuntimeTeamForStep(input: {
    workspaceId?: string;
    userId: string;
    step: WorkflowStep;
    teamName?: string;
    actor: string;
  }): Promise<{ team: ControlPlaneTeam; agent: ControlPlaneAgent }> {
    await ensureWorkspaceHydrated(input.workspaceId, input.userId);
    const requestedTeamName = input.teamName?.trim() || `${input.step.name} Runtime Team`;
    // DASH-64.6: teams read via repository (cross-workspace fallback
    // since the lookup is by name+mode, not id).
    const userTeams = await controlPlaneRepository.listAllTeamsForUser(input.userId);
    let team = userTeams.find(
      (candidate) =>
        candidate.name === requestedTeamName &&
        candidate.deploymentMode === "continuous_agents"
    );
    let teamIsNew = false;
    if (!team) {
      team = createTeamRecord({
        workspaceId: input.workspaceId,
        userId: input.userId,
        name: requestedTeamName,
        description: `Runtime deployment bridge for workflow step ${input.step.name}`,
        deploymentMode: "continuous_agents",
        alertThresholds: [0.8, 0.9, 1],
        orchestrationEnabled: true,
      });
      teamIsNew = true;
    }

    // DASH-64.5: getAgentForWorkflowStep is async (repo-backed).
    let agent = await getAgentForWorkflowStep(team.id, input.userId, input.step);
    let agentIsNew = false;
    if (!agent) {
      agent = provisionStepAgent({
        teamId: team.id,
        userId: input.userId,
        step: input.step,
        budgetMonthlyUsd: input.step.agentBudgetMonthlyUsd ?? 0,
      });
      agentIsNew = true;
    }

    // DASH-64.5: persist newly-provisioned agent via repo (iter-2
    // hardening). Existing agents already live in the repo.
    if (agentIsNew) {
      const runtimeCtx = await workspaceContextForTeam(team.id, input.userId);
      if (!runtimeCtx) {
        throw new Error("agent_provision_workspace_unresolved");
      }
      await controlPlaneRepository.upsertAgent(runtimeCtx, agent);
    }

    // DASH-64.6: persist team via repo. Only fire when the team was
    // just provisioned (existing teams are already in the repo).
    if (teamIsNew) {
      const teamCtx = await workspaceContextForTeam(team.id, input.userId);
      if (!teamCtx) {
        throw new Error("team_create_workspace_unresolved");
      }
      await controlPlaneRepository.upsertTeam(teamCtx, team, teamCompanyIds.get(team.id) ?? null);
    }

    if (postgresPersistenceAvailable() && input.workspaceId) {
      hydratedWorkspaceUsers.add(workspaceUserKey(input.workspaceId, input.userId));
    }

    return { team, agent };
  },

  async updateTeamLifecycle(input: {
    workspaceId?: string;
    teamId: string;
    userId: string;
    action: ControlPlaneLifecycleAction;
  }): Promise<ControlPlaneTeam> {
    await ensureWorkspaceHydrated(input.workspaceId, input.userId);
    // DASH-64.6: getTeamOwnedByUser is async now (repo-backed).
    const team = await getTeamOwnedByUser(input.teamId, input.userId);
    if (!team) {
      throw new Error("team_not_found");
    }

    const timestamp = nowIso();
    switch (input.action) {
      case "pause":
        team.status = "paused";
        team.pausedByCompanyLifecycle = false;
        break;
      case "resume":
      case "restart":
        team.status = "active";
        team.pausedByCompanyLifecycle = false;
        break;
      case "stop":
        team.status = "stopped";
        team.pausedByCompanyLifecycle = false;
        break;
    }

    if (input.action === "restart") {
      team.restartCount += 1;
    }
    team.updatedAt = timestamp;

    // DASH-64.5: agents + executions are now repository-backed. Load
    // → mutate → persist in batch. Resolve workspace ctx ONCE for both.
    // DASH-64.4 iter 2 (mirrors Codex P1 on #901): throw on unresolved
    // workspace ctx so a team-lifecycle action doesn't silently leave
    // queued/running executions in a stale state.
    const lifecycleCtx = await workspaceContextForTeam(team.id, input.userId);
    if (!lifecycleCtx) {
      throw new Error("team_lifecycle_workspace_unresolved");
    }

    const teamAgentsForLifecycle = await this.listAgents(team.id, input.userId);
    for (const agent of teamAgentsForLifecycle) {
      const updatedAgent: ControlPlaneAgent = {
        ...agent,
        status: toAgentStatus(input.action),
        pausedByCompanyLifecycle: false,
        updatedAt: timestamp,
      };
      if (input.action === "stop") {
        updatedAgent.currentExecutionId = undefined;
      }
      await controlPlaneRepository.upsertAgent(lifecycleCtx, updatedAgent);
    }
    if (input.action === "stop" || input.action === "restart") {
      const teamExecutions = await controlPlaneRepository.listExecutions(lifecycleCtx, {
        teamId: team.id,
      });
      if (input.action === "stop") {
        for (const execution of teamExecutions) {
          if (execution.status === "queued" || execution.status === "running") {
            const updated: ControlPlaneExecution = {
              ...execution,
              status: "stopped",
              completedAt: timestamp,
              lastHeartbeatAt: timestamp,
            };
            await controlPlaneRepository.upsertExecution(lifecycleCtx, updated);
          }
        }
      } else {
        for (const execution of teamExecutions) {
          if (execution.status === "failed" || execution.status === "stopped") {
            const updated: ControlPlaneExecution = {
              ...execution,
              status: "queued",
              restartCount: execution.restartCount + 1,
              completedAt: undefined,
              startedAt: undefined,
              lastHeartbeatAt: timestamp,
            };
            await controlPlaneRepository.upsertExecution(lifecycleCtx, updated);
          }
        }
      }
    }

    // DASH-64.6: persist team via repo (reusing the lifecycleCtx we
    // already resolved above).
    await controlPlaneRepository.upsertTeam(lifecycleCtx, team, teamCompanyIds.get(team.id) ?? null);
    if (postgresPersistenceAvailable() && input.workspaceId) {
      hydratedWorkspaceUsers.add(workspaceUserKey(input.workspaceId, input.userId));
    }
    return team;
  },

  async updateAgentSkills(input: {
    workspaceId?: string;
    agentId: string;
    userId: string;
    operation: "assign" | "revoke";
    skills: string[];
  }): Promise<ControlPlaneAgent> {
    await ensureWorkspaceHydrated(input.workspaceId, input.userId);
    // DASH-64.5: getAgentOwnedByUser is now async (repo-backed).
    const agent = await getAgentOwnedByUser(input.agentId, input.userId);
    if (!agent) {
      throw new Error("agent_not_found");
    }

    ensureValidSkillIds(input.skills);

    const current = new Set(agent.skills);
    input.skills.forEach((skill) => {
      if (input.operation === "assign") {
        current.add(skill);
      } else {
        current.delete(skill);
      }
    });
    agent.skills = Array.from(current.values()).sort();
    agent.updatedAt = nowIso();
    // DASH-64.5: agent persists via repository.
    // DASH-64.4: skill propagation onto live executions now flows
    // through the repository (no more in-memory Map mutation).
    //
    // DASH-64.4 iter 2 (mirrors Codex P1 on #901): throw instead of
    // silently dropping skill-update propagation when
    // workspaceContextForTeam returns undefined.
    const skillsCtx = await workspaceContextForTeam(agent.teamId, input.userId);
    if (!skillsCtx) {
      throw new Error("agent_skills_workspace_unresolved");
    }
    const runningExecutions = await controlPlaneRepository.listExecutions(skillsCtx, {
      agentId: agent.id,
      status: "running",
    });
    for (const execution of runningExecutions) {
      const updated: ControlPlaneExecution = {
        ...execution,
        appliedSkills: [...agent.skills],
        lastHeartbeatAt: nowIso(),
      };
      await controlPlaneRepository.upsertExecution(skillsCtx, updated);
    }

    // DASH-64.5: persist agent via repo (handles both test in-memory
    // and prod Postgres paths).
    await controlPlaneRepository.upsertAgent(skillsCtx, agent);
    if (postgresPersistenceAvailable() && input.workspaceId) {
      hydratedWorkspaceUsers.add(workspaceUserKey(input.workspaceId, input.userId));
    }

    return agent;
  },

  async createTask(input: {
    userId: string;
    teamId: string;
    title: string;
    description?: string;
    sourceRunId?: string;
    sourceWorkflowStepId?: string;
    assignedAgentId?: string;
    metadata?: Record<string, unknown>;
    actor: string;
  }): Promise<ControlPlaneTask> {
    // DASH-64.6: getTeamOwnedByUser is async now (repo-backed).
    const team = await getTeamOwnedByUser(input.teamId, input.userId);
    if (!team) {
      throw new Error("team_not_found");
    }

    if (input.assignedAgentId) {
      // DASH-64.5: getAgentOwnedByUser is async now (repo-backed).
      const agent = await getAgentOwnedByUser(input.assignedAgentId, input.userId, team.id);
      if (!agent || agent.teamId !== team.id) {
        throw new Error("agent_not_found");
      }
    }

    const timestamp = nowIso();
    const task: ControlPlaneTask = {
      id: randomUUID(),
      teamId: input.teamId,
      userId: input.userId,
      title: input.title,
      description: input.description,
      sourceRunId: input.sourceRunId,
      sourceWorkflowStepId: input.sourceWorkflowStepId,
      assignedAgentId: input.assignedAgentId,
      status: "todo",
      metadata: input.metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
      auditTrail: [buildAuditEvent("created", input.actor, "Task created with status todo")],
    };
    // DASH-64.1: in-memory `tasks.set` removed. The repository write
    // below is the single source of truth (Postgres in production,
    // in-memory fallback in test mode — see controlPlaneRepository.ts).
    // HEL-66 race-fix snapshots still apply because the observability
    // record carries the data we want at task-creation time, even if
    // a concurrent write updates the task row.
    const snapshotStatus = task.status;
    const snapshotCreatedAt = task.createdAt;
    const snapshotTaskMeta = {
      sourceRunId: task.sourceRunId,
      sourceWorkflowStepId: task.sourceWorkflowStepId,
      metadata: task.metadata,
    };
    // DASH-64.1 iter 4 (Codex P1 on #901): workspaceContextForTeam can
    // return undefined when the team is not in cache AND the DB lookup
    // misses (or errors). Previously this silently no-op'd the upsert,
    // making createTask return success while never persisting the row
    // — the dashboard would briefly see the optimistic task then it
    // disappears on next read. Throw instead so callers see a real
    // failure they can retry.
    const taskCtx = await workspaceContextForTeam(task.teamId, input.userId);
    if (!taskCtx) {
      throw new Error("task_workspace_unresolved");
    }
    await controlPlaneRepository.upsertTask(taskCtx, task);
    observabilityStore.record({
      workspaceId: taskCtx.workspaceId,
      userId: input.userId,
      category: "issue",
      type: "issue.created",
      actor: inferObservabilityActor(input.actor),
      subject: {
        type: "task",
        id: task.id,
        label: task.title,
        parentType: "team",
        parentId: task.teamId,
      },
      summary: `Task created: ${task.title}`,
      payload: {
        status: snapshotStatus,
        ...snapshotTaskMeta,
      },
      occurredAt: snapshotCreatedAt,
    });
    return task;
  },

  // DASH-64.1: now async — reads route through controlPlaneRepository.
  // When workspaceId is provided, scopes to that workspace. When omitted
  // (legacy callers like observability/service.ts that have only userId),
  // walks every workspace via listAllTasksForUser. The team-filter step
  // also restricts to accessible team IDs to preserve the same security
  // boundary the Map-based version had.
  async listTasks(
    userId: string,
    teamId?: string,
    workspaceId?: string,
  ): Promise<ControlPlaneTask[]> {
    // DASH-64.6: listAccessibleTeamIds is async now (repo-backed).
    const accessibleTeamIds = await listAccessibleTeamIds(userId, workspaceId);
    const rows: ControlPlaneTask[] = workspaceId
      ? await controlPlaneRepository.listTasks(
          { workspaceId, userId },
          teamId ? { teamId } : undefined,
        )
      : await controlPlaneRepository.listAllTasksForUser(userId);
    return rows
      .filter((task) => accessibleTeamIds.has(task.teamId) && (!teamId || task.teamId === teamId))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  },

  async checkoutTask(input: {
    taskId: string;
    userId: string;
    actor: string;
    /**
     * DASH-64.1: workspace context for the repository lookup.
     * Routes resolve this from `resolveWorkspaceContext(req, res)`.
     * When omitted (legacy test convention), falls back to userId —
     * same convention as `resolveWorkspaceContext` for in-memory mode.
     */
    workspaceId?: string;
  }): Promise<ControlPlaneTask> {
    const workspaceId = input.workspaceId ?? input.userId;
    const timestamp = nowIso();
    // DASH-64.1 hotfix (Codex review on PR #901): single atomic
    // UPDATE eliminates the read-then-write race the pre-fix version
    // had — two concurrent runs that both saw `checked_out_by = null`
    // could both pass the staleness check and both write. The new
    // `checkoutTaskAtomic` uses `WHERE checked_out_by IS NULL OR
    // checked_out_by = $actor` with RETURNING, so only one writer
    // wins; the loser throws `task_checked_out`.
    const auditEntry = buildAuditEvent(
      "checked_out",
      input.actor,
      `Task checked out by ${input.actor}`,
    );
    const task = await controlPlaneRepository.checkoutTaskAtomic(
      { workspaceId, userId: input.userId },
      {
        taskId: input.taskId,
        actor: input.actor,
        checkedOutAt: timestamp,
        updatedAt: timestamp,
        newStatus: "in_progress",
        auditEntry,
      },
    );
    if (!task) {
      throw new Error("task_not_found");
    }
    // HEL-66 snapshots — the observability event captures the task as
    // it was AT checkout time. Concurrent updates can't perturb these
    // values because we read them off the returned-from-DB row before
    // the next async hop.
    const snapshotStatus = task.status;
    const snapshotUpdatedAt = task.updatedAt;
    const snapshotTaskMeta = {
      sourceRunId: task.sourceRunId,
      sourceWorkflowStepId: task.sourceWorkflowStepId,
      metadata: task.metadata,
    };
    observabilityStore.record({
      workspaceId,
      userId: input.userId,
      category: "issue",
      type: "issue.status_changed",
      actor: inferObservabilityActor(input.actor),
      subject: {
        type: "task",
        id: task.id,
        label: task.title,
        parentType: "team",
        parentId: task.teamId,
      },
      summary: `Task moved to ${snapshotStatus}`,
      payload: {
        previousStatus: "todo",
        status: snapshotStatus,
        ...snapshotTaskMeta,
      },
      occurredAt: snapshotUpdatedAt,
    });
    return task;
  },

  async updateTaskStatus(input: {
    taskId: string;
    userId: string;
    actor: string;
    status: ControlPlaneTaskStatus;
    /** DASH-64.1: workspace context — same fallback as checkoutTask. */
    workspaceId?: string;
  }): Promise<ControlPlaneTask> {
    const workspaceId = input.workspaceId ?? input.userId;
    // DASH-64.1 iter 4 (Codex P2 on #901): atomic update with
    // jsonb-concat audit-trail append. Pre-fix flow was getTask() →
    // mutate in-memory → upsertTask, which dropped audit entries
    // under concurrent status changes (both readers saw the same
    // prior trail). The repository's updateTaskStatusAtomic uses a
    // single UPDATE … audit_trail = COALESCE(audit_trail, '[]'::jsonb)
    // || $entry::jsonb so concurrent appends both land.
    //
    // We do still need `previousStatus` for the observability event,
    // so we read it via getTask BEFORE the atomic update — accepting
    // that the snapshot is best-effort under concurrency (the atomic
    // write below is the source of truth for the row state).
    const taskCtx = { workspaceId, userId: input.userId };
    const before = await controlPlaneRepository.getTask(taskCtx, input.taskId);
    if (!before) {
      throw new Error("task_not_found");
    }
    const previousStatus = before.status;
    const auditEntry = buildAuditEvent(
      "status_changed",
      input.actor,
      `Task status changed to ${input.status}`,
    );
    const timestamp = nowIso();
    const task = await controlPlaneRepository.updateTaskStatusAtomic(taskCtx, {
      taskId: input.taskId,
      newStatus: input.status,
      updatedAt: timestamp,
      auditEntry,
    });
    if (!task) {
      throw new Error("task_not_found");
    }
    const snapshotStatus = task.status;
    const snapshotUpdatedAt = task.updatedAt;
    const snapshotTaskMeta = {
      sourceRunId: task.sourceRunId,
      sourceWorkflowStepId: task.sourceWorkflowStepId,
      metadata: task.metadata,
    };
    observabilityStore.record({
      workspaceId,
      userId: input.userId,
      category: "issue",
      type: "issue.status_changed",
      actor: inferObservabilityActor(input.actor),
      subject: {
        type: "task",
        id: task.id,
        label: task.title,
        parentType: "team",
        parentId: task.teamId,
      },
      summary: `Task moved to ${snapshotStatus}`,
      payload: {
        previousStatus,
        status: snapshotStatus,
        ...snapshotTaskMeta,
      },
      occurredAt: snapshotUpdatedAt,
    });
    return task;
  },

  async updateCompanyLifecycle(input: {
    userId: string;
    action: "pause" | "resume";
    actor: string;
    reason?: string;
  }): Promise<{
    state: Awaited<ReturnType<typeof companyLifecycleStore.getState>>;
    auditEntry: Awaited<ReturnType<typeof companyLifecycleStore.applyAction>>["auditEntry"];
    affectedTeamIds: string[];
    affectedAgentIds: string[];
  }> {
    const timestamp = nowIso();
    const affectedTeamIds: string[] = [];
    const affectedAgentIds: string[] = [];

    // DASH-64.6: teams read from repository, persisted back per
    // mutation (iter-2 hardening throws on unresolved workspace).
    const allTeams = await controlPlaneRepository.listAllTeamsForUser(input.userId);
    for (const team of allTeams) {
      let mutated = false;
      const updated: ControlPlaneTeam = { ...team };
      if (input.action === "pause") {
        if (updated.status === "active") {
          updated.status = "paused";
          updated.pausedByCompanyLifecycle = true;
          updated.updatedAt = timestamp;
          mutated = true;
        }
      } else if (updated.status === "paused" && updated.pausedByCompanyLifecycle) {
        updated.status = "active";
        updated.pausedByCompanyLifecycle = false;
        updated.updatedAt = timestamp;
        mutated = true;
      }
      if (mutated) {
        const lifecycleTeamCtx = teamWorkspaceIds.get(team.id)
          ? { workspaceId: teamWorkspaceIds.get(team.id) as string, userId: input.userId }
          : await workspaceContextForTeam(team.id, input.userId);
        if (!lifecycleTeamCtx) {
          throw new Error("company_lifecycle_workspace_unresolved");
        }
        await controlPlaneRepository.upsertTeam(lifecycleTeamCtx, updated, teamCompanyIds.get(team.id) ?? null);
        affectedTeamIds.push(updated.id);
      }
    }

    // DASH-64.5: agents read from repository, persisted back per
    // mutation (iter-2 hardening throws on unresolved workspace).
    const allAgents = await controlPlaneRepository.listAllAgentsForUser(input.userId);
    for (const agent of allAgents) {
      let mutated = false;
      const updated: ControlPlaneAgent = { ...agent };
      if (input.action === "pause") {
        if (updated.status === "active") {
          updated.status = "paused";
          updated.pausedByCompanyLifecycle = true;
          updated.updatedAt = timestamp;
          mutated = true;
        }
      } else if (updated.status === "paused" && updated.pausedByCompanyLifecycle) {
        updated.status = "active";
        updated.pausedByCompanyLifecycle = false;
        updated.updatedAt = timestamp;
        mutated = true;
      }
      if (mutated) {
        const lifecycleAgentCtx = await workspaceContextForTeam(agent.teamId, input.userId);
        if (!lifecycleAgentCtx) {
          throw new Error("company_lifecycle_workspace_unresolved");
        }
        await controlPlaneRepository.upsertAgent(lifecycleAgentCtx, updated);
        affectedAgentIds.push(updated.id);
      }
    }

    const { state, auditEntry } = await companyLifecycleStore.applyAction({
      userId: input.userId,
      action: input.action,
      runId: input.actor,
      reason: input.reason,
      affectedTeamIds,
      affectedAgentIds,
    });

    return { state, auditEntry, affectedTeamIds, affectedAgentIds };
  },

  async getCompanyLifecycle(userId: string) {
    return companyLifecycleStore.getState(userId);
  },

  async listCompanyLifecycleAudit(userId: string) {
    return companyLifecycleStore.listAudit(userId);
  },

  async recordSpend(input: {
    userId: string;
    teamId: string;
    agentId: string;
    executionId?: string;
    category: SpendCategory;
    costUsd: number;
    model?: string;
    provider?: string;
    toolName?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ControlPlaneSpendEntry> {
    // DASH-64.6: getTeamOwnedByUser is async now (repo-backed).
    const team = await getTeamOwnedByUser(input.teamId, input.userId);
    // DASH-64.5: getAgentOwnedByUser is async now (repo-backed).
    const agent = team
      ? await getAgentOwnedByUser(input.agentId, input.userId, team.id)
      : undefined;
    if (!team || !agent || agent.teamId !== team.id) {
      throw new Error("agent_not_found");
    }

    if (input.executionId) {
      const execution = await getExecutionOwnedByUser(input.executionId, input.userId, team.id);
      if (!execution || execution.teamId !== team.id || execution.agentId !== agent.id) {
        throw new Error("execution_not_found");
      }
    }

    const toolBudget = input.toolName ? team.toolBudgetCeilings[input.toolName] ?? 0 : 0;
    // DASH-64.3: buildTeamSpendSnapshot is now async.
    const snapshot = await buildTeamSpendSnapshot(team);
    const teamWouldExceed =
      team.budgetMonthlyUsd > 0 && snapshot.team.spentUsd >= team.budgetMonthlyUsd;
    const agentSnapshot = snapshot.agents.find((entry) => entry.agentId === agent.id);
    const agentWouldExceed =
      !!agentSnapshot && agent.budgetMonthlyUsd > 0 && agentSnapshot.spentUsd >= agent.budgetMonthlyUsd;
    const toolSnapshot = input.toolName
      ? snapshot.tools.find((entry) => entry.toolName === input.toolName)
      : undefined;
    const toolWouldExceed =
      !!toolSnapshot && toolBudget > 0 && toolSnapshot.spentUsd >= toolBudget;

    if (teamWouldExceed) throw new Error("team_budget_exceeded");
    if (agentWouldExceed) throw new Error("agent_budget_exceeded");
    if (toolWouldExceed) throw new Error("tool_budget_exceeded");

    const entry: ControlPlaneSpendEntry = {
      id: randomUUID(),
      teamId: input.teamId,
      agentId: input.agentId,
      executionId: input.executionId,
      userId: input.userId,
      category: input.category,
      costUsd: Number(input.costUsd.toFixed(4)),
      model: input.model,
      provider: input.provider,
      toolName: input.toolName,
      metadata: input.metadata,
      recordedAt: nowIso(),
    };
    // DASH-64.3: in-memory `spendEntries.set` removed. Repository
    // insertSpendEntry is the only write path (Postgres in production,
    // in-memory fallback for test mode).
    //
    // DASH-64.3 iter 2 (mirrors Codex P1 on #901): throw instead of
    // silently dropping the spend entry when workspaceContextForTeam
    // returns undefined. Lost spend = unbilled compute = real money
    // leakage.
    const spendCtx = await workspaceContextForTeam(input.teamId, input.userId);
    if (!spendCtx) {
      throw new Error("spend_workspace_unresolved");
    }
    await controlPlaneRepository.insertSpendEntry(spendCtx, entry);
    await applyBudgetPolicies(team, agent.id, input.executionId);
    return entry;
  },

  async startAgentExecution(input: {
    workspaceId?: string;
    userId: string;
    actor: string;
    teamId: string;
    step: WorkflowStep;
    sourceRunId: string;
    metadata?: Record<string, unknown>;
    requestedAgentId?: string;
    taskTitle?: string;
    taskDescription?: string;
  }): Promise<{ execution: ControlPlaneExecution; agent: ControlPlaneAgent; task?: ControlPlaneTask }> {
    await ensureWorkspaceHydrated(input.workspaceId, input.userId);
    if (await companyLifecycleStore.isPaused(input.userId)) {
      throw new Error("company_paused");
    }

    // DASH-64.6: getTeamOwnedByUser is async now (repo-backed).
    const team = await getTeamOwnedByUser(input.teamId, input.userId);
    if (!team) {
      throw new Error("team_not_found");
    }

    // DASH-64.5: getAgentOwnedByUser + getAgentForWorkflowStep are
    // async now (repo-backed).
    const explicitAgent = input.requestedAgentId
      ? await getAgentOwnedByUser(input.requestedAgentId, input.userId, team.id)
      : undefined;
    const agent =
      explicitAgent ??
      (await getAgentForWorkflowStep(input.teamId, input.userId, input.step));
    if (!agent || agent.teamId !== team.id) {
      throw new Error("agent_not_found");
    }

    assertAgentWorkspaceBinding({
      agentId: agent.id,
      agentTeamId: agent.teamId,
      resolvedTeamId: team.id,
      teamWorkspaceId: teamWorkspaceIds.get(team.id),
      claimedWorkspaceId: input.workspaceId,
    });

    // DASH-64.3: buildTeamSpendSnapshot is now async.
    const teamSnapshot = await buildTeamSpendSnapshot(team);
    const agentSnapshot = teamSnapshot.agents.find((entry) => entry.agentId === agent.id);
    if (team.status !== "active") {
      if (teamSnapshot.team.budgetUsd > 0 && teamSnapshot.team.spentUsd >= teamSnapshot.team.budgetUsd) {
        throw new Error("team_budget_exceeded");
      }
      throw new Error("team_not_active");
    }
    if (agent.status !== "active") {
      if (agentSnapshot && agentSnapshot.budgetUsd > 0 && agentSnapshot.spentUsd >= agentSnapshot.budgetUsd) {
        throw new Error("agent_budget_exceeded");
      }
      throw new Error("agent_not_active");
    }
    await assertExecutionAllowed(team, agent);

    const task =
      input.taskTitle && input.taskTitle.trim()
        ? await this.createTask({
            userId: input.userId,
            teamId: team.id,
            title: input.taskTitle.trim(),
            description: input.taskDescription,
            sourceRunId: input.sourceRunId,
            sourceWorkflowStepId: input.step.id,
            assignedAgentId: agent.id,
            metadata: input.metadata,
            actor: input.actor,
          })
        : undefined;

    const requestedAt = nowIso();
    const execution: ControlPlaneExecution = {
      id: randomUUID(),
      teamId: team.id,
      agentId: agent.id,
      userId: input.userId,
      sourceRunId: input.sourceRunId,
      sourceWorkflowStepId: input.step.id,
      sourceWorkflowStepName: input.step.name,
      taskId: task?.id,
      status: "running",
      appliedSkills: [...agent.skills],
      metadata: input.metadata,
      requestedAt,
      startedAt: requestedAt,
      lastHeartbeatAt: requestedAt,
      restartCount: 0,
    };
    // DASH-64.4: persist via repository (test in-mem bucket + prod
    // Postgres path both handled there).
    //
    // DASH-64.4 iter 2 (mirrors Codex P1 on #901): throw instead of
    // silently dropping the execution row when workspaceContextForTeam
    // returns undefined. Without this, startAgentExecution would
    // return a phantom execution that disappears on the next read.
    const startCtx = await workspaceContextForTeam(team.id, input.userId);
    if (!startCtx) {
      throw new Error("execution_workspace_unresolved");
    }
    await controlPlaneRepository.upsertExecution(startCtx, execution);

    agent.currentExecutionId = execution.id;
    agent.lastHeartbeatAt = requestedAt;
    agent.lastHeartbeatStatus = "running";
    normalizeAgentStatusForSuccessfulHeartbeat(agent, "running");
    agent.updatedAt = requestedAt;
    // DASH-64.5: persist agent mutation BEFORE recordHeartbeat fetches
    // a fresh copy via repo.getAgent (otherwise the mutation would be
    // lost). Reuses startCtx (same workspace).
    await controlPlaneRepository.upsertAgent(startCtx, agent);

    team.lastHeartbeatAt = requestedAt;
    team.updatedAt = requestedAt;

    await this.recordHeartbeat({
      workspaceId: input.workspaceId,
      userId: input.userId,
      teamId: team.id,
      agentId: agent.id,
      executionId: execution.id,
      status: "running",
      summary: `Started workflow step ${input.step.name}`,
      createdTaskIds: task ? [task.id] : [],
    });

    observabilityStore.record({
      workspaceId: input.workspaceId,
      userId: input.userId,
      category: "run",
      type: "run.started",
      actor: { type: "agent", id: agent.id, label: agent.name },
      subject: {
        type: "execution",
        id: execution.id,
        label: input.step.name,
        parentType: "team",
        parentId: team.id,
      },
      summary: `Started workflow step ${input.step.name}`,
      payload: {
        status: "running",
        sourceRunId: input.sourceRunId,
        workflowStepId: input.step.id,
        workflowStepName: input.step.name,
        taskId: task?.id,
        metadata: input.metadata,
      },
      occurredAt: execution.requestedAt,
    });

    // DASH-64.6: persist team via repo (reusing startCtx).
    await controlPlaneRepository.upsertTeam(startCtx, team, teamCompanyIds.get(team.id) ?? null);
    if (postgresPersistenceAvailable() && input.workspaceId) {
      hydratedWorkspaceUsers.add(workspaceUserKey(input.workspaceId, input.userId));
    }

    return { execution, agent, task };
  },

  async finalizeAgentExecution(input: {
    workspaceId?: string;
    executionId: string;
    userId: string;
    status: Exclude<ControlPlaneExecutionStatus, "queued" | "running">;
    summary?: string;
    costUsd?: number;
    spendEntries?: Array<{
      category: SpendCategory;
      costUsd: number;
      model?: string;
      provider?: string;
      toolName?: string;
      metadata?: Record<string, unknown>;
    }>;
  }): Promise<ControlPlaneExecution> {
    await ensureWorkspaceHydrated(input.workspaceId, input.userId);
    const execution = await getExecutionOwnedByUser(input.executionId, input.userId);
    if (!execution) {
      throw new Error("execution_not_found");
    }

    const timestamp = nowIso();
    execution.status = input.status;
    execution.summary = input.summary;
    execution.costUsd = input.costUsd;
    execution.lastHeartbeatAt = timestamp;
    execution.completedAt = timestamp;
    // DASH-64.4: persist execution mutation via repository.
    //
    // DASH-64.4 iter 2 (mirrors Codex P1 on #901): throw instead of
    // silently dropping the finalize write — the run would appear
    // to have completed but the row would still show "running" on
    // next read.
    const finalizeCtx = await workspaceContextForTeam(execution.teamId, input.userId);
    if (!finalizeCtx) {
      throw new Error("execution_workspace_unresolved");
    }
    await controlPlaneRepository.upsertExecution(finalizeCtx, execution);

    // DASH-64.5: agent read+written via repository.
    const agent = await controlPlaneRepository.getAgent(finalizeCtx, execution.agentId);
    if (agent) {
      agent.currentExecutionId = undefined;
      agent.lastHeartbeatAt = timestamp;
      agent.lastHeartbeatStatus = toHeartbeatStatus(input.status);
      normalizeAgentStatusForSuccessfulHeartbeat(agent, agent.lastHeartbeatStatus);
      agent.updatedAt = timestamp;
      await controlPlaneRepository.upsertAgent(finalizeCtx, agent);
    }

    // DASH-64.6: team read+written via repository.
    const team = await controlPlaneRepository.getTeam(finalizeCtx, execution.teamId);
    if (team) {
      team.lastHeartbeatAt = timestamp;
      team.updatedAt = timestamp;
      await controlPlaneRepository.upsertTeam(finalizeCtx, team, teamCompanyIds.get(team.id) ?? null);
    }

    if (Array.isArray(input.spendEntries) && input.spendEntries.length > 0) {
      for (const entry of input.spendEntries) {
        await this.recordSpend({
          userId: input.userId,
          teamId: execution.teamId,
          agentId: execution.agentId,
          executionId: execution.id,
          category: entry.category,
          costUsd: entry.costUsd,
          model: entry.model,
          provider: entry.provider,
          toolName: entry.toolName,
          metadata: entry.metadata,
        });
      }
    } else if (typeof input.costUsd === "number" && input.costUsd > 0) {
      await this.recordSpend({
        userId: input.userId,
        teamId: execution.teamId,
        agentId: execution.agentId,
        executionId: execution.id,
        category: "compute",
        costUsd: input.costUsd,
        metadata: { source: "execution_finalize" },
      });
    }

    void this.recordHeartbeat({
      workspaceId: input.workspaceId,
      userId: input.userId,
      teamId: execution.teamId,
      agentId: execution.agentId,
      executionId: execution.id,
      status: toHeartbeatStatus(input.status),
      summary: input.summary,
      costUsd: input.costUsd,
      completedAt: timestamp,
    });

    observabilityStore.record({
      workspaceId: input.workspaceId ?? teamWorkspaceIds.get(execution.teamId),
      userId: input.userId,
      category: "run",
      type: `run.${input.status}`,
      actor: { type: "agent", id: execution.agentId, label: agent?.name },
      subject: {
        type: "execution",
        id: execution.id,
        label: execution.sourceWorkflowStepName,
        parentType: "team",
        parentId: execution.teamId,
      },
      summary: input.summary ?? `Execution ${input.status}`,
      payload: {
        status: input.status,
        sourceRunId: execution.sourceRunId,
        workflowStepId: execution.sourceWorkflowStepId,
        workflowStepName: execution.sourceWorkflowStepName,
        taskId: execution.taskId,
        costUsd: input.costUsd,
        metadata: execution.metadata,
      },
      occurredAt: timestamp,
    });

    if (input.status === "blocked" || input.status === "failed") {
      observabilityStore.record({
        workspaceId: input.workspaceId ?? teamWorkspaceIds.get(execution.teamId),
        userId: input.userId,
        category: "alert",
        type: "alert.triggered",
        actor: { type: "agent", id: execution.agentId, label: agent?.name },
        subject: {
          type: "execution",
          id: execution.id,
          label: execution.sourceWorkflowStepName,
          parentType: "team",
          parentId: execution.teamId,
        },
        summary: input.summary ?? `Execution ${input.status}`,
        payload: {
          severity: input.status === "failed" ? "critical" : "warning",
          code: input.status === "failed" ? "run_failed" : "run_blocked",
          sourceCategory: "run",
          sourceId: execution.id,
          executionId: execution.id,
        },
        occurredAt: timestamp,
      });
    }

    if (postgresPersistenceAvailable() && input.workspaceId) {
      // DASH-64.4: execution persisted above via repo.upsertExecution.
      // DASH-64.5: agent persisted above via repo.upsertAgent.
      // DASH-64.6: team persisted above via repo.upsertTeam.
      hydratedWorkspaceUsers.add(workspaceUserKey(input.workspaceId, input.userId));
    }

    return execution;
  },

  async updateExecutionLifecycle(input: {
    workspaceId?: string;
    executionId: string;
    userId: string;
    action: Extract<ControlPlaneLifecycleAction, "restart" | "stop">;
  }): Promise<ControlPlaneExecution> {
    await ensureWorkspaceHydrated(input.workspaceId, input.userId);
    const execution = await getExecutionOwnedByUser(input.executionId, input.userId);
    if (!execution) {
      throw new Error("execution_not_found");
    }

    const timestamp = nowIso();
    if (input.action === "stop") {
      execution.status = "stopped";
      execution.completedAt = timestamp;
    } else {
      execution.status = "queued";
      execution.startedAt = undefined;
      execution.completedAt = undefined;
      execution.restartCount += 1;
    }
    execution.lastHeartbeatAt = timestamp;
    // DASH-64.4: execution persistence now routes entirely through the
    // repository (Postgres for prod, in-memory bucket for tests). The
    // previous in-TX upsertExecutionRow call is no longer needed.
    //
    // DASH-64.4 iter 2 (mirrors Codex P1 on #901): throw on unresolved
    // workspace ctx instead of silently dropping the lifecycle update.
    const lifecycleCtx = await workspaceContextForTeam(execution.teamId, input.userId);
    if (!lifecycleCtx) {
      throw new Error("execution_workspace_unresolved");
    }
    await controlPlaneRepository.upsertExecution(lifecycleCtx, execution);
    if (postgresPersistenceAvailable() && input.workspaceId) {
      hydratedWorkspaceUsers.add(workspaceUserKey(input.workspaceId, input.userId));
    }
    return execution;
  },

  async recordHeartbeat(input: {
    workspaceId?: string;
    userId: string;
    teamId: string;
    agentId: string;
    executionId?: string;
    status: AgentHeartbeatRecord["status"];
    summary?: string;
    costUsd?: number;
    spendEntries?: Array<{
      category: SpendCategory;
      costUsd: number;
      model?: string;
      provider?: string;
      toolName?: string;
      metadata?: Record<string, unknown>;
    }>;
    createdTaskIds?: string[];
    completedAt?: string;
  }): Promise<AgentHeartbeatRecord> {
    await ensureWorkspaceHydrated(input.workspaceId, input.userId);
    const companyState = await companyLifecycleStore.getState(input.userId);
    // DASH-64.6: getTeamOwnedByUser is async now (repo-backed).
    const team = await getTeamOwnedByUser(input.teamId, input.userId);
    // DASH-64.5: getAgentOwnedByUser is async now (repo-backed).
    const agent = team
      ? await getAgentOwnedByUser(input.agentId, input.userId, team.id)
      : undefined;
    if (!team || !agent || agent.teamId !== team.id) {
      throw new Error("agent_not_found");
    }

    let execution = input.executionId
      ? await getExecutionOwnedByUser(input.executionId, input.userId, team.id)
      : undefined;

    if (input.executionId) {
      if (!execution || execution.teamId !== team.id || execution.agentId !== agent.id) {
        throw new Error("execution_not_found");
      }
    }

    if (companyState.status === "paused") {
      const canProceed =
        execution && wasExecutionRequestedBeforePause(execution.requestedAt, companyState.pausedAt);
      if (!canProceed) {
        throw new Error("company_paused");
      }
    }

    if (execution) {
      execution.lastHeartbeatAt = nowIso();
      // DASH-64.4: persist execution heartbeat via repository (in-memory
      // bucket in test, Postgres in prod). The in-TX upsertExecutionRow
      // call below is removed since the repo already wrote it.
      //
      // DASH-64.4 iter 2 (mirrors Codex P1 on #901): throw on
      // unresolved workspace ctx so the caller learns the heartbeat
      // didn't actually persist instead of silently no-op'ing.
      const heartbeatExecCtx = await workspaceContextForTeam(execution.teamId, input.userId);
      if (!heartbeatExecCtx) {
        throw new Error("execution_workspace_unresolved");
      }
      await controlPlaneRepository.upsertExecution(heartbeatExecCtx, execution);
    }

    const timestamp = nowIso();
    team.lastHeartbeatAt = timestamp;
    team.updatedAt = timestamp;
    agent.lastHeartbeatAt = timestamp;
    agent.lastHeartbeatStatus = input.status;
    normalizeAgentStatusForSuccessfulHeartbeat(agent, input.status);
    agent.updatedAt = timestamp;

    const heartbeat: AgentHeartbeatRecord = {
      id: randomUUID(),
      teamId: input.teamId,
      agentId: input.agentId,
      executionId: input.executionId,
      userId: input.userId,
      status: input.status,
      summary: input.summary,
      costUsd: input.costUsd,
      createdTaskIds: input.createdTaskIds ?? [],
      startedAt: timestamp,
      completedAt: input.completedAt,
    };
    // DASH-64.2: `heartbeats.set` removed. The repository.insertHeartbeat
    // call below is the only write path (Postgres in production,
    // in-memory fallback in test mode).

    if (Array.isArray(input.spendEntries) && input.spendEntries.length > 0) {
      for (const entry of input.spendEntries) {
        await this.recordSpend({
          userId: input.userId,
          teamId: input.teamId,
          agentId: input.agentId,
          executionId: input.executionId,
          category: entry.category,
          costUsd: entry.costUsd,
          model: entry.model,
          provider: entry.provider,
          toolName: entry.toolName,
          metadata: entry.metadata,
        });
      }
    } else if (typeof input.costUsd === "number" && input.costUsd > 0) {
      await this.recordSpend({
        userId: input.userId,
        teamId: input.teamId,
        agentId: input.agentId,
        executionId: input.executionId,
        category: "compute",
        costUsd: input.costUsd,
        metadata: { source: "heartbeat" },
      });
    }

    observabilityStore.record({
      workspaceId: input.workspaceId,
      userId: input.userId,
      category: "heartbeat",
      type: "heartbeat.recorded",
      actor: { type: "agent", id: agent.id, label: agent.name },
      subject: {
        type: "agent",
        id: agent.id,
        label: agent.name,
        parentType: "team",
        parentId: team.id,
      },
      summary: input.summary ?? `Heartbeat ${input.status}`,
      payload: {
        status: input.status,
        executionId: input.executionId,
        createdTaskIds: input.createdTaskIds ?? [],
        costUsd: input.costUsd,
      },
      occurredAt: heartbeat.completedAt ?? heartbeat.startedAt,
    });

    if (typeof input.costUsd === "number" && input.costUsd > 0) {
      observabilityStore.record({
        workspaceId: input.workspaceId,
        userId: input.userId,
        category: "budget",
        type: "budget.spent",
        actor: { type: "agent", id: agent.id, label: agent.name },
        subject: {
          type: "agent",
          id: agent.id,
          label: agent.name,
          parentType: "team",
          parentId: team.id,
        },
        summary: `Recorded $${input.costUsd.toFixed(2)} spend for ${agent.name}`,
        payload: {
          deltaUsd: input.costUsd,
          executionId: input.executionId,
          period: (heartbeat.completedAt ?? heartbeat.startedAt).slice(0, 7),
        },
        occurredAt: heartbeat.completedAt ?? heartbeat.startedAt,
      });
    }

    if (input.status === "blocked") {
      observabilityStore.record({
        workspaceId: input.workspaceId,
        userId: input.userId,
        category: "alert",
        type: "alert.triggered",
        actor: { type: "agent", id: agent.id, label: agent.name },
        subject: {
          type: "agent",
          id: agent.id,
          label: agent.name,
          parentType: "team",
          parentId: team.id,
        },
        summary: input.summary ?? `${agent.name} heartbeat blocked`,
        payload: {
          severity: "warning",
          code: "heartbeat_blocked",
          sourceCategory: "heartbeat",
          sourceId: heartbeat.id,
          executionId: input.executionId,
        },
        occurredAt: heartbeat.completedAt ?? heartbeat.startedAt,
      });
    }

    // DASH-64.5: persist mutated agent via repo. Iter-2 hardening:
    // we resolved heartbeatCtx earlier; reuse it (workspace context is
    // the same as the heartbeat's).
    const agentPersistCtx = await workspaceContextForTeam(team.id, input.userId);
    if (!agentPersistCtx) {
      throw new Error("heartbeat_workspace_unresolved");
    }
    await controlPlaneRepository.upsertAgent(agentPersistCtx, agent);

    // DASH-64.6: persist team via repo (reusing agentPersistCtx).
    await controlPlaneRepository.upsertTeam(agentPersistCtx, team, teamCompanyIds.get(team.id) ?? null);
    if (postgresPersistenceAvailable() && input.workspaceId) {
      hydratedWorkspaceUsers.add(workspaceUserKey(input.workspaceId, input.userId));
    }

    // DASH-64.2: heartbeat write is now unconditional — the repository's
    // useInMemoryFallback handles test mode, and the workspace context
    // resolves either from input.workspaceId or via workspaceContextForTeam.
    //
    // DASH-64.2 iter 3 (mirrors Codex P1 on #901): workspaceContextForTeam
    // can return undefined when the team is not cached AND the DB lookup
    // misses/errors. Throw instead of silently dropping the heartbeat
    // so the caller sees a real failure they can retry.
    const heartbeatCtx = input.workspaceId
      ? { workspaceId: input.workspaceId, userId: input.userId }
      : await workspaceContextForTeam(team.id, input.userId);
    if (!heartbeatCtx) {
      throw new Error("heartbeat_workspace_unresolved");
    }
    await controlPlaneRepository.insertHeartbeat(heartbeatCtx, heartbeat);

    return heartbeat;
  },

  // DASH-64.2: now async — reads route through controlPlaneRepository.
  // The accessibleTeamIds filter is preserved to maintain the same
  // workspace-membership access semantics the old Map provided.
  //
  // DASH-64.2 hotfix (Codex review on PR #902): when workspaceId is
  // omitted, look up the team's workspace via teamWorkspaceIds (cache
  // populated on team create) and fall back to listAllHeartbeatsForUser
  // (SECURITY DEFINER, migration 047) for the no-team case. The
  // previous `workspaceId ?? userId` fallback returned empty in
  // production because the real workspace id differs from userId and
  // agent_heartbeats has FORCE RLS.
  async listHeartbeats(
    userId: string,
    teamId?: string,
    workspaceId?: string,
  ): Promise<AgentHeartbeatRecord[]> {
    // DASH-64.6: listAccessibleTeamIds is async now (repo-backed).
    const accessibleTeamIds = await listAccessibleTeamIds(userId, workspaceId);
    let resolvedWorkspaceId = workspaceId;
    if (!resolvedWorkspaceId && teamId) {
      const teamCtx = await workspaceContextForTeam(teamId, userId);
      resolvedWorkspaceId = teamCtx?.workspaceId;
    }
    const rows: AgentHeartbeatRecord[] = resolvedWorkspaceId
      ? await controlPlaneRepository.listHeartbeats(
          { workspaceId: resolvedWorkspaceId, userId },
          teamId ? { teamId } : undefined,
        )
      : await controlPlaneRepository.listAllHeartbeatsForUser(userId);
    return rows
      .filter((heartbeat) => accessibleTeamIds.has(heartbeat.teamId) && (!teamId || heartbeat.teamId === teamId))
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  },

  clear(): void {
    // DASH-64.6: teams Map gone; cleared via the repository reset.
    // DASH-64.5: agents Map gone; cleared via the repository reset.
    // DASH-64.1: tasks Map no longer lives here.
    // DASH-64.2: heartbeats Map no longer lives here either.
    // Both — plus future spend/budget-alert Maps — are cleared via the
    // repository's __resetRepositoryInMemoryStateForTests().
    __resetRepositoryInMemoryStateForTests();
    // DASH-64.4: executions Map gone; cleared via the repository reset.
    // DASH-64.7: companies + companyWorkspaces + companySecretBindings
    // + companyIdempotencyIndex Maps gone; cleared via repository reset.
    companyLifecycleStore.clear();
    // DASH-64.3: spendEntries / budgetAlerts Maps gone; the repository
    // owns these too. __resetRepositoryInMemoryStateForTests() above
    // already clears the spend/alert buckets.
    teamWorkspaceIds.clear();
    teamCompanyIds.clear();
    companyTenantWorkspaceIds.clear();
    hydratedWorkspaceUsers.clear();
  },
};

export function resetControlPlaneStoreForTests(): void {
  controlPlaneStore.clear();
}
