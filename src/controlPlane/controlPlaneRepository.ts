/**
 * Control-plane execution-state repository (ALT-2042 / ALT-1915 Phase 4).
 *
 * Replaces the in-process `tasks`, `heartbeats`, `spendEntries`, and
 * `budgetAlerts` Maps in src/controlPlane/controlPlaneStore.ts with PostgreSQL
 * tables (see migrations/019_control_plane_execution_state.sql) so execution
 * state survives a process restart and remains workspace-isolated under RLS.
 *
 * Every method here routes through `withWorkspaceContext` so the
 * `app.current_workspace_id` session var is always set inside the same
 * transaction as the query. Cross-tenant queries return zero rows by RLS, and
 * a missing session var returns zero rows by NULL-denial — same hardened
 * pattern as Phases 2/3.
 */

import { PoolClient } from "pg";
import { getPostgresPool, inMemoryAllowed, isPostgresConfigured } from "../db/postgres";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import {
  AgentHeartbeatRecord,
  AgentLifecycleStatus,
  BudgetAlertScope,
  ControlPlaneAgent,
  ControlPlaneAgentSchedule,
  ControlPlaneBudgetAlert,
  ControlPlaneExecution,
  ControlPlaneExecutionStatus,
  ControlPlaneSpendEntry,
  ControlPlaneTask,
  ControlPlaneTaskAuditEvent,
  ControlPlaneTaskStatus,
  ControlPlaneTeam,
  HeartbeatStatus,
  ProvisionedCompanyRecord,
  ProvisionedCompanyWorkspace,
  SpendCategory,
  TeamDeploymentMode,
  TeamLifecycleStatus,
} from "./types";

// ---------------------------------------------------------------------------
// DASH-64.1: In-memory fallback for test/dev mode (HEL-80 pattern).
//
// Production runs with DATABASE_URL set and everything routes through
// Postgres via withWorkspaceContext. Unit tests typically run without
// Postgres available — the previous architecture handled this by keeping
// a parallel in-memory Map at the controlPlaneStore level. DASH-64
// removes those Maps in favor of repository-only reads, so the
// fallback moves here.
//
// `inMemoryAllowed()` is true in NODE_ENV=test / development. Production
// fails fast on the Postgres path because `inMemoryAllowed()` is false
// and the repository goes straight to withWorkspaceContext (which throws
// if Postgres isn't configured — by design, see HEL-80).
//
// Each in-memory store is a workspace-scoped Map<workspaceId, Map<id, row>>
// so cross-tenant isolation behaves the same as RLS would in production.
// ---------------------------------------------------------------------------

// allowlist: test/dev fallback for repository; production routes to Postgres
const memTasks = new Map<string, Map<string, ControlPlaneTask>>();
// allowlist: test/dev fallback for repository; production routes to Postgres
const memHeartbeats = new Map<string, Map<string, AgentHeartbeatRecord>>();
// allowlist: test/dev fallback for repository; production routes to Postgres
const memSpendEntries = new Map<string, Map<string, ControlPlaneSpendEntry>>();
// allowlist: test/dev fallback for repository; production routes to Postgres
const memBudgetAlerts = new Map<string, Map<string, ControlPlaneBudgetAlert>>();
// allowlist: test/dev fallback for repository; production routes to Postgres
// DASH-64.4: executions Map ownership moves from controlPlaneStore to repo.
// allowlist: test/dev fallback for repository; production routes to Postgres
const memExecutions = new Map<string, Map<string, ControlPlaneExecution>>();
// DASH-64.5: agents Map ownership moves from controlPlaneStore to repo.
// allowlist: test/dev fallback for repository; production routes to Postgres
const memAgents = new Map<string, Map<string, ControlPlaneAgent>>();
// DASH-64.6: teams Map ownership moves from controlPlaneStore to repo.
// allowlist: test/dev fallback for repository; production routes to Postgres
const memTeams = new Map<string, Map<string, ControlPlaneTeam>>();
// DASH-64.7: companies + companyWorkspaces + companySecretBindings +
// companyIdempotencyIndex Maps move from controlPlaneStore to repo.
// In-memory rows are stored in a single bucket keyed by tenantWorkspaceId
// (the workspace_id column in `companies`) for RLS parity.
interface MemCompanyEntry {
  company: ProvisionedCompanyRecord;
  workspace: ProvisionedCompanyWorkspace;
  tenantWorkspaceId: string;
  fingerprint: string;
  secretBindings: Record<string, string>;
}
// allowlist: test/dev fallback for repository; production routes to Postgres
const memCompanies = new Map<string, Map<string, MemCompanyEntry>>();

function memBucket<T>(
  store: Map<string, Map<string, T>>,
  workspaceId: string,
): Map<string, T> {
  let bucket = store.get(workspaceId);
  if (!bucket) {
    bucket = new Map<string, T>();
    store.set(workspaceId, bucket);
  }
  return bucket;
}

/**
 * Returns true when the repository should use its in-memory fallback
 * instead of going to Postgres. Same gate as HEL-80 elsewhere in the
 * codebase: tests + development without DATABASE_URL.
 */
function useInMemoryFallback(): boolean {
  return !isPostgresConfigured() && inMemoryAllowed();
}

export interface ControlPlaneRepoContext {
  workspaceId: string;
  userId: string;
}

interface TaskRow {
  id: string;
  team_id: string;
  user_id: string;
  title: string;
  description: string | null;
  source_run_id: string | null;
  source_workflow_step_id: string | null;
  assigned_agent_id: string | null;
  execution_id: string | null;
  status: ControlPlaneTaskStatus;
  checked_out_by: string | null;
  checked_out_at: Date | null;
  audit_trail: ControlPlaneTaskAuditEvent[];
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

interface HeartbeatRow {
  id: string;
  team_id: string;
  user_id: string;
  agent_id: string;
  execution_id: string | null;
  status: HeartbeatStatus;
  summary: string | null;
  cost_usd: string | null;
  created_task_ids: string[];
  started_at: Date;
  completed_at: Date | null;
}

interface SpendEntryRow {
  id: string;
  team_id: string;
  agent_id: string;
  user_id: string;
  execution_id: string | null;
  category: SpendCategory;
  cost_usd: string;
  model: string | null;
  provider: string | null;
  tool_name: string | null;
  metadata: Record<string, unknown> | null;
  recorded_at: Date;
}

interface ExecutionRow {
  id: string;
  workspace_id: string;
  team_id: string;
  user_id: string;
  agent_id: string;
  source_run_id: string;
  source_workflow_step_id: string;
  source_workflow_step_name: string;
  task_id: string | null;
  status: ControlPlaneExecutionStatus;
  applied_skills: string[] | null;
  metadata: Record<string, unknown> | null;
  summary: string | null;
  cost_usd: string | null;
  requested_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  last_heartbeat_at: Date | null;
  restart_count: number;
}

interface CompanyRow {
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
  budget_monthly_usd: string | number;
  allocated_budget_monthly_usd: string | number;
  remaining_budget_monthly_usd: string | number;
  created_at: Date;
  updated_at: Date;
}

interface TeamRow {
  id: string;
  workspace_id: string;
  user_id: string;
  company_id: string | null;
  name: string;
  description: string | null;
  workflow_template_id: string | null;
  workflow_template_name: string | null;
  deployment_mode: TeamDeploymentMode;
  status: TeamLifecycleStatus;
  paused_by_company_lifecycle: boolean | null;
  restart_count: number;
  budget_monthly_usd: string | number;
  tool_budget_ceilings: Record<string, number> | null;
  alert_thresholds: number[] | null;
  orchestration_enabled: boolean;
  last_heartbeat_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface AgentRow {
  id: string;
  workspace_id: string;
  user_id: string;
  team_id: string;
  name: string;
  role_key: string;
  workflow_step_id: string | null;
  workflow_step_kind: string | null;
  model: string | null;
  instructions: string;
  budget_monthly_usd: string | number;
  reporting_to_agent_id: string | null;
  skills: string[] | null;
  schedule: ControlPlaneAgentSchedule | null;
  status: AgentLifecycleStatus;
  paused_by_company_lifecycle: boolean | null;
  current_execution_id: string | null;
  last_heartbeat_at: Date | null;
  last_heartbeat_status: HeartbeatStatus | null;
  created_at: Date;
  updated_at: Date;
}

interface BudgetAlertRow {
  id: string;
  team_id: string;
  user_id: string;
  agent_id: string | null;
  tool_name: string | null;
  scope: BudgetAlertScope;
  threshold: string;
  budget_usd: string;
  spent_usd: string;
  recorded_at: Date;
}

function isoFromDate(value: Date | null | undefined): string | undefined {
  return value ? value.toISOString() : undefined;
}

function isoFromDateRequired(value: Date): string {
  return value.toISOString();
}

function numericFromString(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function numericFromStringRequired(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("invalid_numeric_value");
  }
  return parsed;
}

function rowToTask(row: TaskRow): ControlPlaneTask {
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    title: row.title,
    description: row.description ?? undefined,
    sourceRunId: row.source_run_id ?? undefined,
    sourceWorkflowStepId: row.source_workflow_step_id ?? undefined,
    assignedAgentId: row.assigned_agent_id ?? undefined,
    checkedOutBy: row.checked_out_by ?? undefined,
    checkedOutAt: isoFromDate(row.checked_out_at),
    status: row.status,
    metadata: row.metadata ?? undefined,
    createdAt: isoFromDateRequired(row.created_at),
    updatedAt: isoFromDateRequired(row.updated_at),
    auditTrail: Array.isArray(row.audit_trail) ? row.audit_trail : [],
  };
}

function rowToHeartbeat(row: HeartbeatRow): AgentHeartbeatRecord {
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    agentId: row.agent_id,
    executionId: row.execution_id ?? undefined,
    status: row.status,
    summary: row.summary ?? undefined,
    costUsd: numericFromString(row.cost_usd),
    createdTaskIds: Array.isArray(row.created_task_ids) ? row.created_task_ids : [],
    startedAt: isoFromDateRequired(row.started_at),
    completedAt: isoFromDate(row.completed_at),
  };
}

function rowToSpendEntry(row: SpendEntryRow): ControlPlaneSpendEntry {
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    agentId: row.agent_id,
    executionId: row.execution_id ?? undefined,
    category: row.category,
    costUsd: numericFromStringRequired(row.cost_usd),
    model: row.model ?? undefined,
    provider: row.provider ?? undefined,
    toolName: row.tool_name ?? undefined,
    metadata: row.metadata ?? undefined,
    recordedAt: isoFromDateRequired(row.recorded_at),
  };
}

function rowToExecution(row: ExecutionRow): ControlPlaneExecution {
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? (row.metadata as Record<string, unknown>)
    : undefined;
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    agentId: row.agent_id,
    sourceRunId: row.source_run_id,
    sourceWorkflowStepId: row.source_workflow_step_id,
    sourceWorkflowStepName: row.source_workflow_step_name,
    taskId: row.task_id ?? undefined,
    status: row.status,
    appliedSkills: Array.isArray(row.applied_skills) ? row.applied_skills : [],
    metadata,
    summary: row.summary ?? undefined,
    costUsd: numericFromString(row.cost_usd),
    requestedAt: isoFromDateRequired(row.requested_at),
    startedAt: isoFromDate(row.started_at),
    completedAt: isoFromDate(row.completed_at),
    lastHeartbeatAt: isoFromDate(row.last_heartbeat_at),
    restartCount: row.restart_count,
  };
}

function rowToProvisionedCompany(row: CompanyRow): {
  company: ProvisionedCompanyRecord;
  workspace: ProvisionedCompanyWorkspace;
  tenantWorkspaceId: string;
} {
  const budget = typeof row.budget_monthly_usd === "string"
    ? Number.parseFloat(row.budget_monthly_usd)
    : row.budget_monthly_usd;
  const allocated = typeof row.allocated_budget_monthly_usd === "string"
    ? Number.parseFloat(row.allocated_budget_monthly_usd)
    : row.allocated_budget_monthly_usd;
  const remaining = typeof row.remaining_budget_monthly_usd === "string"
    ? Number.parseFloat(row.remaining_budget_monthly_usd)
    : row.remaining_budget_monthly_usd;
  const company: ProvisionedCompanyRecord = {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    externalCompanyId: row.external_company_id ?? undefined,
    workspaceId: row.provisioned_workspace_id,
    teamId: row.team_id,
    idempotencyKey: row.idempotency_key,
    budgetMonthlyUsd: Number.isFinite(budget) ? Number(budget) : 0,
    allocatedBudgetMonthlyUsd: Number.isFinite(allocated) ? Number(allocated) : 0,
    remainingBudgetMonthlyUsd: Number.isFinite(remaining) ? Number(remaining) : 0,
    createdAt: isoFromDateRequired(row.created_at),
    updatedAt: isoFromDateRequired(row.updated_at),
  };
  const workspace: ProvisionedCompanyWorkspace = {
    id: row.provisioned_workspace_id,
    name: row.provisioned_workspace_name,
    slug: row.provisioned_workspace_slug,
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
  };
  return { company, workspace, tenantWorkspaceId: row.workspace_id };
}

function rowToTeam(row: TeamRow): ControlPlaneTeam {
  const budget = typeof row.budget_monthly_usd === "string"
    ? Number.parseFloat(row.budget_monthly_usd)
    : row.budget_monthly_usd;
  const toolBudget = row.tool_budget_ceilings && typeof row.tool_budget_ceilings === "object"
    ? (row.tool_budget_ceilings as Record<string, number>)
    : {};
  const alertThresholds = Array.isArray(row.alert_thresholds)
    ? row.alert_thresholds
    : [0.8, 0.9, 1];
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description ?? undefined,
    workflowTemplateId: row.workflow_template_id ?? undefined,
    workflowTemplateName: row.workflow_template_name ?? undefined,
    workflowId: row.workflow_template_id ?? undefined,
    workflowName: row.workflow_template_name ?? undefined,
    deploymentMode: row.deployment_mode,
    status: row.status,
    pausedByCompanyLifecycle: row.paused_by_company_lifecycle || undefined,
    restartCount: row.restart_count,
    lastHeartbeatAt: isoFromDate(row.last_heartbeat_at),
    budgetMonthlyUsd: Number.isFinite(budget) ? Number(budget) : 0,
    toolBudgetCeilings: toolBudget,
    alertThresholds,
    orchestrationEnabled: row.orchestration_enabled,
    createdAt: isoFromDateRequired(row.created_at),
    updatedAt: isoFromDateRequired(row.updated_at),
  };
}

function rowToAgent(row: AgentRow): ControlPlaneAgent {
  const budget = typeof row.budget_monthly_usd === "string"
    ? Number.parseFloat(row.budget_monthly_usd)
    : row.budget_monthly_usd;
  const schedule: ControlPlaneAgentSchedule =
    row.schedule && typeof row.schedule === "object" && !Array.isArray(row.schedule)
      ? (row.schedule as ControlPlaneAgentSchedule)
      : { type: "manual" };
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    name: row.name,
    roleKey: row.role_key,
    workflowStepId: row.workflow_step_id ?? undefined,
    workflowStepKind: row.workflow_step_kind ?? undefined,
    model: row.model ?? undefined,
    instructions: row.instructions ?? "",
    budgetMonthlyUsd: Number.isFinite(budget) ? Number(budget) : 0,
    reportingToAgentId: row.reporting_to_agent_id ?? undefined,
    skills: Array.isArray(row.skills) ? row.skills : [],
    schedule,
    status: row.status,
    pausedByCompanyLifecycle: row.paused_by_company_lifecycle || undefined,
    currentExecutionId: row.current_execution_id ?? undefined,
    lastHeartbeatAt: isoFromDate(row.last_heartbeat_at),
    lastHeartbeatStatus: row.last_heartbeat_status ?? undefined,
    createdAt: isoFromDateRequired(row.created_at),
    updatedAt: isoFromDateRequired(row.updated_at),
  };
}

function rowToBudgetAlert(row: BudgetAlertRow): ControlPlaneBudgetAlert {
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    agentId: row.agent_id ?? undefined,
    toolName: row.tool_name ?? undefined,
    scope: row.scope,
    threshold: numericFromStringRequired(row.threshold),
    budgetUsd: numericFromStringRequired(row.budget_usd),
    spentUsd: numericFromStringRequired(row.spent_usd),
    recordedAt: isoFromDateRequired(row.recorded_at),
  };
}

async function insertTaskRow(client: PoolClient, ctx: ControlPlaneRepoContext, task: ControlPlaneTask): Promise<void> {
  await client.query(
    `INSERT INTO agent_tasks (
       id, workspace_id, user_id, team_id, assigned_agent_id, execution_id,
       title, description, source_run_id, source_workflow_step_id,
       status, checked_out_by, checked_out_at, audit_trail, metadata,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10,
       $11, $12, $13, $14::jsonb, $15::jsonb,
       $16, $17
     )
     ON CONFLICT (id) DO UPDATE SET
       assigned_agent_id = EXCLUDED.assigned_agent_id,
       execution_id = EXCLUDED.execution_id,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       status = EXCLUDED.status,
       checked_out_by = EXCLUDED.checked_out_by,
       checked_out_at = EXCLUDED.checked_out_at,
       audit_trail = EXCLUDED.audit_trail,
       metadata = EXCLUDED.metadata,
       updated_at = EXCLUDED.updated_at`,
    [
      task.id,
      ctx.workspaceId,
      task.userId,
      task.teamId,
      task.assignedAgentId ?? null,
      null, // execution_id - reserved for future cross-link
      task.title,
      task.description ?? null,
      task.sourceRunId ?? null,
      task.sourceWorkflowStepId ?? null,
      task.status,
      task.checkedOutBy ?? null,
      task.checkedOutAt ? new Date(task.checkedOutAt) : null,
      JSON.stringify(task.auditTrail ?? []),
      task.metadata ? JSON.stringify(task.metadata) : null,
      new Date(task.createdAt),
      new Date(task.updatedAt),
    ]
  );
}

async function insertHeartbeatRow(
  client: PoolClient,
  ctx: ControlPlaneRepoContext,
  heartbeat: AgentHeartbeatRecord
): Promise<void> {
  await client.query(
    `INSERT INTO agent_heartbeats (
       id, workspace_id, user_id, team_id, agent_id, execution_id,
       status, summary, cost_usd, created_task_ids,
       started_at, completed_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10::jsonb,
       $11, $12
     )
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       summary = EXCLUDED.summary,
       cost_usd = EXCLUDED.cost_usd,
       created_task_ids = EXCLUDED.created_task_ids,
       completed_at = EXCLUDED.completed_at`,
    [
      heartbeat.id,
      ctx.workspaceId,
      heartbeat.userId,
      heartbeat.teamId,
      heartbeat.agentId,
      heartbeat.executionId ?? null,
      heartbeat.status,
      heartbeat.summary ?? null,
      heartbeat.costUsd ?? null,
      JSON.stringify(heartbeat.createdTaskIds ?? []),
      new Date(heartbeat.startedAt),
      heartbeat.completedAt ? new Date(heartbeat.completedAt) : null,
    ]
  );
}

async function insertSpendEntryRow(
  client: PoolClient,
  ctx: ControlPlaneRepoContext,
  entry: ControlPlaneSpendEntry
): Promise<void> {
  await client.query(
    `INSERT INTO spend_entries (
       id, workspace_id, user_id, team_id, agent_id, execution_id,
       category, cost_usd, model, provider, tool_name, metadata, recorded_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11, $12::jsonb, $13
     )
     ON CONFLICT (id) DO NOTHING`,
    [
      entry.id,
      ctx.workspaceId,
      entry.userId,
      entry.teamId,
      entry.agentId,
      entry.executionId ?? null,
      entry.category,
      entry.costUsd,
      entry.model ?? null,
      entry.provider ?? null,
      entry.toolName ?? null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      new Date(entry.recordedAt),
    ]
  );
}

async function upsertCompanyRowInClient(
  client: PoolClient,
  input: {
    company: ProvisionedCompanyRecord;
    workspace: ProvisionedCompanyWorkspace;
    tenantWorkspaceId: string;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO companies (
       id, workspace_id, user_id, name, external_company_id, provisioned_workspace_id,
       provisioned_workspace_name, provisioned_workspace_slug, team_id, idempotency_key,
       budget_monthly_usd, allocated_budget_monthly_usd, remaining_budget_monthly_usd,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11, $12, $13,
       $14, $15
     )
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           external_company_id = EXCLUDED.external_company_id,
           provisioned_workspace_name = EXCLUDED.provisioned_workspace_name,
           provisioned_workspace_slug = EXCLUDED.provisioned_workspace_slug,
           team_id = EXCLUDED.team_id,
           idempotency_key = EXCLUDED.idempotency_key,
           budget_monthly_usd = EXCLUDED.budget_monthly_usd,
           allocated_budget_monthly_usd = EXCLUDED.allocated_budget_monthly_usd,
           remaining_budget_monthly_usd = EXCLUDED.remaining_budget_monthly_usd,
           updated_at = EXCLUDED.updated_at`,
    [
      input.company.id,
      input.tenantWorkspaceId,
      input.company.userId,
      input.company.name,
      input.company.externalCompanyId ?? null,
      input.workspace.id,
      input.workspace.name,
      input.workspace.slug,
      input.company.teamId,
      input.company.idempotencyKey,
      input.company.budgetMonthlyUsd,
      input.company.allocatedBudgetMonthlyUsd,
      input.company.remainingBudgetMonthlyUsd,
      input.company.createdAt,
      input.company.updatedAt,
    ]
  );
}

async function upsertTeamRowInClient(
  client: PoolClient,
  ctx: ControlPlaneRepoContext,
  team: ControlPlaneTeam,
  companyId: string | null
): Promise<void> {
  await client.query(
    `INSERT INTO agent_teams (
       id, workspace_id, user_id, company_id, name, description, workflow_template_id,
       workflow_template_name, deployment_mode, status, paused_by_company_lifecycle,
       restart_count, budget_monthly_usd, tool_budget_ceilings, alert_thresholds,
       orchestration_enabled, last_heartbeat_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
       $12, $13, $14::jsonb, $15::jsonb, $16, $17, $18, $19
     )
     ON CONFLICT (id) DO UPDATE
       -- DASH-64.8: COALESCE so callers can pass companyId=null without
       -- clobbering an existing link. The teamCompanyIds cache used to
       -- carry the linkage; with the cache gone, only provisioning
       -- knows the company at upsert time.
       SET company_id = COALESCE(EXCLUDED.company_id, agent_teams.company_id),
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           workflow_template_id = EXCLUDED.workflow_template_id,
           workflow_template_name = EXCLUDED.workflow_template_name,
           deployment_mode = EXCLUDED.deployment_mode,
           status = EXCLUDED.status,
           paused_by_company_lifecycle = EXCLUDED.paused_by_company_lifecycle,
           restart_count = EXCLUDED.restart_count,
           budget_monthly_usd = EXCLUDED.budget_monthly_usd,
           tool_budget_ceilings = EXCLUDED.tool_budget_ceilings,
           alert_thresholds = EXCLUDED.alert_thresholds,
           orchestration_enabled = EXCLUDED.orchestration_enabled,
           last_heartbeat_at = EXCLUDED.last_heartbeat_at,
           updated_at = EXCLUDED.updated_at`,
    [
      team.id,
      ctx.workspaceId,
      team.userId,
      companyId,
      team.name,
      team.description ?? null,
      team.workflowTemplateId ?? null,
      team.workflowTemplateName ?? null,
      team.deploymentMode,
      team.status,
      team.pausedByCompanyLifecycle ?? false,
      team.restartCount,
      team.budgetMonthlyUsd,
      JSON.stringify(team.toolBudgetCeilings),
      JSON.stringify(team.alertThresholds),
      team.orchestrationEnabled,
      team.lastHeartbeatAt ?? null,
      team.createdAt,
      team.updatedAt,
    ]
  );
}

async function upsertAgentRowInClient(
  client: PoolClient,
  ctx: ControlPlaneRepoContext,
  agent: ControlPlaneAgent
): Promise<void> {
  await client.query(
    `INSERT INTO agents (
       id, workspace_id, user_id, team_id, name, role_key, workflow_step_id, workflow_step_kind,
       model, instructions, budget_monthly_usd, reporting_to_agent_id, skills, schedule,
       status, paused_by_company_lifecycle, current_execution_id, last_heartbeat_at,
       last_heartbeat_status, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13::jsonb, $14::jsonb,
       $15, $16, $17, $18, $19, $20, $21
     )
     ON CONFLICT (id) DO UPDATE
       SET team_id = EXCLUDED.team_id,
           name = EXCLUDED.name,
           role_key = EXCLUDED.role_key,
           workflow_step_id = EXCLUDED.workflow_step_id,
           workflow_step_kind = EXCLUDED.workflow_step_kind,
           model = EXCLUDED.model,
           instructions = EXCLUDED.instructions,
           budget_monthly_usd = EXCLUDED.budget_monthly_usd,
           reporting_to_agent_id = EXCLUDED.reporting_to_agent_id,
           skills = EXCLUDED.skills,
           schedule = EXCLUDED.schedule,
           status = EXCLUDED.status,
           paused_by_company_lifecycle = EXCLUDED.paused_by_company_lifecycle,
           current_execution_id = EXCLUDED.current_execution_id,
           last_heartbeat_at = COALESCE(EXCLUDED.last_heartbeat_at, agents.last_heartbeat_at),
           last_heartbeat_status = COALESCE(EXCLUDED.last_heartbeat_status, agents.last_heartbeat_status),
           updated_at = EXCLUDED.updated_at`,
    [
      agent.id,
      ctx.workspaceId,
      agent.userId,
      agent.teamId,
      agent.name,
      agent.roleKey,
      agent.workflowStepId ?? null,
      agent.workflowStepKind ?? null,
      agent.model ?? null,
      agent.instructions,
      agent.budgetMonthlyUsd,
      agent.reportingToAgentId ?? null,
      JSON.stringify(agent.skills),
      JSON.stringify(agent.schedule),
      agent.status,
      agent.pausedByCompanyLifecycle ?? false,
      agent.currentExecutionId ?? null,
      agent.lastHeartbeatAt ?? null,
      agent.lastHeartbeatStatus ?? null,
      agent.createdAt,
      agent.updatedAt,
    ]
  );
}

async function upsertExecutionRow(
  client: PoolClient,
  ctx: ControlPlaneRepoContext,
  execution: ControlPlaneExecution
): Promise<void> {
  await client.query(
    `INSERT INTO agent_executions (
       id, workspace_id, user_id, team_id, agent_id, source_run_id, source_workflow_step_id,
       source_workflow_step_name, task_id, status, applied_skills, metadata, summary, cost_usd,
       requested_at, started_at, completed_at, last_heartbeat_at, restart_count
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14,
       $15, $16, $17, $18, $19
     )
     ON CONFLICT (id) DO UPDATE SET
       team_id = EXCLUDED.team_id,
       agent_id = EXCLUDED.agent_id,
       source_run_id = EXCLUDED.source_run_id,
       source_workflow_step_id = EXCLUDED.source_workflow_step_id,
       source_workflow_step_name = EXCLUDED.source_workflow_step_name,
       task_id = EXCLUDED.task_id,
       status = EXCLUDED.status,
       applied_skills = EXCLUDED.applied_skills,
       metadata = EXCLUDED.metadata,
       summary = EXCLUDED.summary,
       cost_usd = EXCLUDED.cost_usd,
       requested_at = EXCLUDED.requested_at,
       started_at = EXCLUDED.started_at,
       completed_at = EXCLUDED.completed_at,
       last_heartbeat_at = EXCLUDED.last_heartbeat_at,
       restart_count = EXCLUDED.restart_count`,
    [
      execution.id,
      ctx.workspaceId,
      execution.userId,
      execution.teamId,
      execution.agentId,
      execution.sourceRunId,
      execution.sourceWorkflowStepId,
      execution.sourceWorkflowStepName,
      execution.taskId ?? null,
      execution.status,
      JSON.stringify(execution.appliedSkills ?? []),
      execution.metadata ? JSON.stringify(execution.metadata) : null,
      execution.summary ?? null,
      execution.costUsd ?? null,
      new Date(execution.requestedAt),
      execution.startedAt ? new Date(execution.startedAt) : null,
      execution.completedAt ? new Date(execution.completedAt) : null,
      execution.lastHeartbeatAt ? new Date(execution.lastHeartbeatAt) : null,
      execution.restartCount,
    ]
  );
}

async function upsertBudgetAlertRow(
  client: PoolClient,
  ctx: ControlPlaneRepoContext,
  alert: ControlPlaneBudgetAlert
): Promise<void> {
  // Match the in-memory dedupe semantics: at most one row per
  // (scope, team, agent|tool, threshold). The partial unique indexes from
  // migration 019 enforce this at the DB level.
  let conflictTarget: string;
  switch (alert.scope) {
    case "team":
      conflictTarget = "(team_id, threshold) WHERE scope = 'team'";
      break;
    case "agent":
      conflictTarget = "(team_id, agent_id, threshold) WHERE scope = 'agent' AND agent_id IS NOT NULL";
      break;
    case "tool":
      conflictTarget = "(team_id, tool_name, threshold) WHERE scope = 'tool' AND tool_name IS NOT NULL";
      break;
  }

  await client.query(
    `INSERT INTO budget_alerts (
       id, workspace_id, user_id, team_id, agent_id, tool_name,
       scope, threshold, budget_usd, spent_usd, recorded_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11
     )
     ON CONFLICT ${conflictTarget} DO UPDATE SET
       budget_usd = EXCLUDED.budget_usd,
       spent_usd = EXCLUDED.spent_usd,
       recorded_at = EXCLUDED.recorded_at`,
    [
      alert.id,
      ctx.workspaceId,
      alert.userId,
      alert.teamId,
      alert.agentId ?? null,
      alert.toolName ?? null,
      alert.scope,
      alert.threshold,
      alert.budgetUsd,
      alert.spentUsd,
      new Date(alert.recordedAt),
    ]
  );
}

export const controlPlaneRepository = {
  async upsertTask(ctx: ControlPlaneRepoContext, task: ControlPlaneTask): Promise<void> {
    if (useInMemoryFallback()) {
      memBucket(memTasks, ctx.workspaceId).set(task.id, { ...task });
      return;
    }
    await withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      await insertTaskRow(client, ctx, task);
    });
  },

  /**
   * DASH-64.1 iter 4 (Codex P2 on PR #901): atomic status update.
   * Same race as checkoutTask had — the pre-fix flow read the task,
   * appended to the in-memory audit trail, and upserted. Two
   * concurrent status changes both read the same prior trail, both
   * appended an entry, and the later upsert replaced the earlier
   * row, dropping the earlier transition entirely.
   *
   * Fix: UPDATE with `audit_trail = COALESCE(audit_trail, '[]'::jsonb)
   * || $newEntry::jsonb` so both concurrent appends are preserved by
   * Postgres's jsonb concatenation, and RETURNING gives us the final
   * row without a follow-up SELECT.
   *
   * Returns the updated task, or undefined if the task doesn't exist.
   */
  async updateTaskStatusAtomic(
    ctx: ControlPlaneRepoContext,
    input: {
      taskId: string;
      newStatus: ControlPlaneTaskStatus;
      updatedAt: string;
      auditEntry: ControlPlaneTaskAuditEvent;
    },
  ): Promise<ControlPlaneTask | undefined> {
    if (useInMemoryFallback()) {
      let task: ControlPlaneTask | undefined;
      let bucket: Map<string, ControlPlaneTask> | undefined;
      for (const b of memTasks.values()) {
        const t = b.get(input.taskId);
        if (t) {
          task = t;
          bucket = b;
          break;
        }
      }
      if (!task || !bucket) return undefined;
      const updated: ControlPlaneTask = {
        ...task,
        status: input.newStatus,
        updatedAt: input.updatedAt,
        auditTrail: [...task.auditTrail, input.auditEntry],
      };
      bucket.set(updated.id, updated);
      return { ...updated };
    }
    return withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      const result = await client.query<TaskRow>(
        `UPDATE agent_tasks
            SET status = $2,
                updated_at = $3,
                audit_trail = COALESCE(audit_trail, '[]'::jsonb) || $4::jsonb
          WHERE id = $1
       RETURNING id, team_id, user_id, title, description, source_run_id,
                 source_workflow_step_id, assigned_agent_id, execution_id, status,
                 checked_out_by, checked_out_at, audit_trail, metadata,
                 created_at, updated_at`,
        [
          input.taskId,
          input.newStatus,
          new Date(input.updatedAt),
          JSON.stringify([input.auditEntry]),
        ],
      );
      if (result.rowCount === 0) return undefined;
      return rowToTask(result.rows[0]);
    });
  },

  /**
   * DASH-64.1 hotfix (Codex review on PR #901): atomic conditional
   * checkout. The previous flow did `getTask()` → mutate in-memory →
   * `upsertTask()`, which races when two runs try to claim the same
   * unclaimed task concurrently: both reads see `checked_out_by =
   * null`, both passes the check, both upserts succeed, both callers
   * receive success — but only one upsert wins.
   *
   * Fix: a single UPDATE statement with `WHERE checked_out_by IS NULL
   * OR checked_out_by = $actor` + RETURNING. If another actor already
   * holds the lease, the WHERE filter rejects the update and 0 rows
   * are returned → throw task_checked_out. If 1 row is returned, this
   * caller successfully claimed (or re-claimed) the task.
   *
   * Returns the updated task row, or undefined if the task doesn't
   * exist. Throws `task_checked_out` when another actor holds it.
   */
  async checkoutTaskAtomic(
    ctx: ControlPlaneRepoContext,
    input: {
      taskId: string;
      actor: string;
      checkedOutAt: string; // ISO timestamp
      updatedAt: string; // ISO timestamp
      newStatus: ControlPlaneTaskStatus; // "in_progress"
      auditEntry: ControlPlaneTaskAuditEvent;
    },
  ): Promise<ControlPlaneTask | undefined> {
    if (useInMemoryFallback()) {
      // Find the task across all buckets (test-mode legacy behaviour).
      let task: ControlPlaneTask | undefined;
      let bucket: Map<string, ControlPlaneTask> | undefined;
      for (const b of memTasks.values()) {
        const t = b.get(input.taskId);
        if (t) {
          task = t;
          bucket = b;
          break;
        }
      }
      if (!task || !bucket) return undefined;
      if (task.checkedOutBy && task.checkedOutBy !== input.actor) {
        throw new Error("task_checked_out");
      }
      const updated: ControlPlaneTask = {
        ...task,
        checkedOutBy: input.actor,
        checkedOutAt: input.checkedOutAt,
        status: input.newStatus,
        updatedAt: input.updatedAt,
        auditTrail: [...task.auditTrail, input.auditEntry],
      };
      bucket.set(updated.id, updated);
      return { ...updated };
    }
    return withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      // Atomic compare-and-set: the WHERE clause covers two cases —
      // (a) task is unclaimed (checked_out_by IS NULL), or (b) this
      // actor is re-claiming a task they already hold (idempotent).
      // Any other actor's hold makes the WHERE return zero rows.
      const result = await client.query<TaskRow>(
        `UPDATE agent_tasks
            SET checked_out_by = $2,
                checked_out_at = $3,
                status = $4,
                updated_at = $5,
                audit_trail = COALESCE(audit_trail, '[]'::jsonb) || $6::jsonb
          WHERE id = $1
            AND (checked_out_by IS NULL OR checked_out_by = $2)
       RETURNING id, team_id, user_id, title, description, source_run_id,
                 source_workflow_step_id, assigned_agent_id, execution_id, status,
                 checked_out_by, checked_out_at, audit_trail, metadata,
                 created_at, updated_at`,
        [
          input.taskId,
          input.actor,
          new Date(input.checkedOutAt),
          input.newStatus,
          new Date(input.updatedAt),
          JSON.stringify([input.auditEntry]),
        ],
      );
      if (result.rowCount === 0) {
        // Either the task doesn't exist or another actor holds it.
        // Distinguish by a plain SELECT.
        const exists = await client.query(
          `SELECT 1 FROM agent_tasks WHERE id = $1`,
          [input.taskId],
        );
        if (exists.rowCount === 0) return undefined;
        throw new Error("task_checked_out");
      }
      return rowToTask(result.rows[0]);
    });
  },

  /**
   * DASH-64.1: single-task lookup. Used by checkoutTask / updateTaskStatus
   * paths that need to read a row before mutating it. Returns undefined
   * when the task doesn't exist OR the caller doesn't own it (user_id
   * filter — Postgres-side via RLS, in-memory-side via explicit check).
   */
  async getTask(
    ctx: ControlPlaneRepoContext,
    taskId: string,
  ): Promise<ControlPlaneTask | undefined> {
    if (useInMemoryFallback()) {
      // First check the requested workspace's bucket.
      const inWorkspace = memBucket(memTasks, ctx.workspaceId).get(taskId);
      if (inWorkspace) return { ...inWorkspace };
      // DASH-64.1: in tests, callers often don't have a workspace
      // resolved (the route layer hasn't wired one through yet — that's
      // DASH-64.6 work). Walk every bucket to preserve the old
      // global-Map behaviour. Production RLS makes this branch
      // unreachable.
      for (const bucket of memTasks.values()) {
        const task = bucket.get(taskId);
        if (task) return { ...task };
      }
      return undefined;
    }
    return withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      // DASH-64.1: workspace RLS is the access boundary; the id alone
      // identifies the task.
      const result = await client.query<TaskRow>(
        `SELECT id, team_id, user_id, title, description, source_run_id,
                source_workflow_step_id, assigned_agent_id, execution_id, status,
                checked_out_by, checked_out_at, audit_trail, metadata,
                created_at, updated_at
           FROM agent_tasks
          WHERE id = $1`,
        [taskId],
      );
      const row = result.rows[0];
      return row ? rowToTask(row) : undefined;
    });
  },


  async listTasks(
    ctx: ControlPlaneRepoContext,
    filters?: { teamId?: string }
  ): Promise<ControlPlaneTask[]> {
    if (useInMemoryFallback()) {
      // DASH-64.1: workspace IS the access boundary (RLS analogue).
      // No userId filter — anyone with access to the workspace sees
      // its tasks. The pre-DASH-64 in-memory Map used team-accessibility
      // via listAccessibleTeamIds, which checks workspace membership.
      const bucket = memBucket(memTasks, ctx.workspaceId);
      return Array.from(bucket.values())
        .filter((task) => !filters?.teamId || task.teamId === filters.teamId)
        .map((task) => ({ ...task }))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    }
    return withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      // DASH-64.1: no user_id filter — workspace RLS is the access
      // boundary. The user_id column tracks who CREATED the task; it's
      // not used for access control.
      const params: unknown[] = [];
      const conditions: string[] = [];
      if (filters?.teamId) {
        params.push(filters.teamId);
        conditions.push(`team_id = $${params.length}`);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const result = await client.query<TaskRow>(
        `SELECT id, team_id, user_id, title, description, source_run_id,
                source_workflow_step_id, assigned_agent_id, execution_id, status,
                checked_out_by, checked_out_at, audit_trail, metadata,
                created_at, updated_at
           FROM agent_tasks
          ${where}
          ORDER BY created_at ASC`,
        params
      );
      return result.rows.map(rowToTask);
    });
  },

  /**
   * DASH-64.1: list every task across every workspace this user owns.
   * The team-less listTasks variant — used by the observability service's
   * cross-workspace dashboard and any other code path that has a userId
   * but no specific workspace in hand. In-memory fallback walks every
   * bucket; Postgres returns the full user-scoped set under RLS.
   *
   * NOTE: production callers SHOULD pass a workspaceId when they have one
   * for tighter RLS scoping. This helper exists for the legacy
   * `controlPlaneStore.listTasks(userId)` shape which had no workspace
   * filter.
   */
  async listAllTasksForUser(userId: string): Promise<ControlPlaneTask[]> {
    if (useInMemoryFallback()) {
      const out: ControlPlaneTask[] = [];
      for (const bucket of memTasks.values()) {
        for (const task of bucket.values()) {
          if (task.userId === userId) out.push({ ...task });
        }
      }
      return out.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    }
    // DASH-64.1 followup (Codex on PR #901): the previous raw
    // `pool.query` against `agent_tasks` returned zero rows in
    // production because FORCE RLS requires `app.current_workspace_id`
    // to be set, and a cross-workspace listing has no single workspace
    // context to pin.
    //
    // Migration 046 adds `list_agent_tasks_for_user(p_user_id text)` as
    // a SECURITY DEFINER helper. Same pattern as `lookup_team_workspace_id`.
    //
    // DASH-64.1 iter 3 (Codex P1 on #901): the helper is bound to the
    // authenticated subject via `app.current_user_id`. We MUST set
    // that session var before calling, otherwise the function returns
    // zero rows by NULL-denial. We use a dedicated client + transaction
    // so the `set_config(..., true)` is scoped to this query alone
    // (true = local-to-transaction).
    const pool = getPostgresPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      const result = await client.query<TaskRow>(
        `SELECT id, team_id, user_id, title, description, source_run_id,
                source_workflow_step_id, assigned_agent_id, execution_id, status,
                checked_out_by, checked_out_at, audit_trail, metadata,
                created_at, updated_at
           FROM list_agent_tasks_for_user($1)`,
        [userId],
      );
      await client.query("COMMIT");
      return result.rows.map(rowToTask);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },

  async insertHeartbeat(
    ctx: ControlPlaneRepoContext,
    heartbeat: AgentHeartbeatRecord
  ): Promise<void> {
    if (useInMemoryFallback()) {
      memBucket(memHeartbeats, ctx.workspaceId).set(heartbeat.id, { ...heartbeat });
      return;
    }
    await withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      await insertHeartbeatRow(client, ctx, heartbeat);
    });
  },

  /**
   * DASH-64.2 hotfix (Codex review on PR #902): workspace-less
   * fallback for legacy callers that have a userId but no resolved
   * workspaceId. Same pattern as listAllTasksForUser → migration 047
   * SECURITY DEFINER helper (RLS bypass scoped to user_id filter).
   */
  async listAllHeartbeatsForUser(userId: string): Promise<AgentHeartbeatRecord[]> {
    if (useInMemoryFallback()) {
      const out: AgentHeartbeatRecord[] = [];
      for (const bucket of memHeartbeats.values()) {
        for (const heartbeat of bucket.values()) {
          if (heartbeat.userId === userId) out.push({ ...heartbeat });
        }
      }
      return out.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    }
    // DASH-64.2 iter 2 (Codex P1, same as listAllTasksForUser):
    // migration 047's helper now binds to the authenticated subject
    // via app.current_user_id. Backend MUST set that session var
    // before calling; we use a dedicated client + transaction so
    // set_config(..., true) is scoped to this query alone.
    const pool = getPostgresPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      const result = await client.query<HeartbeatRow>(
        `SELECT id, team_id, user_id, agent_id, execution_id, status,
                summary, cost_usd, created_task_ids, started_at, completed_at
           FROM list_agent_heartbeats_for_user($1)`,
        [userId],
      );
      await client.query("COMMIT");
      return result.rows.map(rowToHeartbeat);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },

  async listHeartbeats(
    ctx: ControlPlaneRepoContext,
    filters?: { agentId?: string; teamId?: string; limit?: number }
  ): Promise<AgentHeartbeatRecord[]> {
    if (useInMemoryFallback()) {
      const bucket = memBucket(memHeartbeats, ctx.workspaceId);
      let rows = Array.from(bucket.values()).filter((heartbeat) => {
        if (filters?.agentId && heartbeat.agentId !== filters.agentId) return false;
        if (filters?.teamId && heartbeat.teamId !== filters.teamId) return false;
        return true;
      });
      // DASH-64.2: cross-workspace fallback for test-mode callers that
      // haven't wired workspace context. The legacy global-Map had no
      // bucket; production RLS makes this branch unreachable.
      if (rows.length === 0 && memHeartbeats.size > 1) {
        const all: AgentHeartbeatRecord[] = [];
        for (const b of memHeartbeats.values()) {
          for (const heartbeat of b.values()) {
            if (heartbeat.userId !== ctx.userId) continue;
            if (filters?.agentId && heartbeat.agentId !== filters.agentId) continue;
            if (filters?.teamId && heartbeat.teamId !== filters.teamId) continue;
            all.push(heartbeat);
          }
        }
        rows = all;
      }
      const sorted = rows
        .map((heartbeat) => ({ ...heartbeat }))
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
      if (typeof filters?.limit === "number" && filters.limit > 0) {
        return sorted.slice(0, filters.limit);
      }
      return sorted;
    }
    return withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      const params: unknown[] = [ctx.userId];
      let where = "user_id = $1";
      if (filters?.agentId) {
        params.push(filters.agentId);
        where += ` AND agent_id = $${params.length}`;
      }
      if (filters?.teamId) {
        params.push(filters.teamId);
        where += ` AND team_id = $${params.length}`;
      }
      let limitClause = "";
      if (typeof filters?.limit === "number" && filters.limit > 0) {
        params.push(filters.limit);
        limitClause = ` LIMIT $${params.length}`;
      }
      const result = await client.query<HeartbeatRow>(
        `SELECT id, team_id, user_id, agent_id, execution_id, status,
                summary, cost_usd, created_task_ids, started_at, completed_at
           FROM agent_heartbeats
          WHERE ${where}
          ORDER BY started_at DESC${limitClause}`,
        params
      );
      return result.rows.map(rowToHeartbeat);
    });
  },

  async insertSpendEntry(
    ctx: ControlPlaneRepoContext,
    entry: ControlPlaneSpendEntry
  ): Promise<void> {
    if (useInMemoryFallback()) {
      memBucket(memSpendEntries, ctx.workspaceId).set(entry.id, { ...entry });
      return;
    }
    await withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      await insertSpendEntryRow(client, ctx, entry);
    });
  },

  async listSpendEntries(
    ctx: ControlPlaneRepoContext,
    filters?: { teamId?: string; agentId?: string; since?: string }
  ): Promise<ControlPlaneSpendEntry[]> {
    if (useInMemoryFallback()) {
      const bucket = memBucket(memSpendEntries, ctx.workspaceId);
      return Array.from(bucket.values())
        .filter((entry) => {
          if (filters?.teamId && entry.teamId !== filters.teamId) return false;
          if (filters?.agentId && entry.agentId !== filters.agentId) return false;
          if (filters?.since && entry.recordedAt < filters.since) return false;
          return true;
        })
        .map((entry) => ({ ...entry }))
        .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
    }
    return withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      const params: unknown[] = [ctx.userId];
      let where = "user_id = $1";
      if (filters?.teamId) {
        params.push(filters.teamId);
        where += ` AND team_id = $${params.length}`;
      }
      if (filters?.agentId) {
        params.push(filters.agentId);
        where += ` AND agent_id = $${params.length}`;
      }
      if (filters?.since) {
        params.push(new Date(filters.since));
        where += ` AND recorded_at >= $${params.length}`;
      }
      const result = await client.query<SpendEntryRow>(
        `SELECT id, team_id, user_id, agent_id, execution_id, category, cost_usd,
                model, provider, tool_name, metadata, recorded_at
           FROM spend_entries
          WHERE ${where}
          ORDER BY recorded_at DESC`,
        params
      );
      return result.rows.map(rowToSpendEntry);
    });
  },

  async upsertBudgetAlert(
    ctx: ControlPlaneRepoContext,
    alert: ControlPlaneBudgetAlert
  ): Promise<void> {
    if (useInMemoryFallback()) {
      // DASH-64.3: in-memory fallback mirrors Postgres's ON CONFLICT
      // dedupe semantics. Postgres uses partial unique indexes per
      // scope (team / agent / tool) so concurrent inserts with the
      // same scope-key cluster atomically converge to one row. The
      // pre-DASH-64.3 store had its own `budgetAlertDedupeKey` Map
      // check; that's gone now — the repository owns the dedup
      // contract.
      const bucket = memBucket(memBudgetAlerts, ctx.workspaceId);
      const matchKey = (a: ControlPlaneBudgetAlert): boolean => {
        if (a.userId !== alert.userId) return false;
        if (a.teamId !== alert.teamId) return false;
        if (a.scope !== alert.scope) return false;
        if (a.threshold !== alert.threshold) return false;
        if (alert.scope === "agent" && a.agentId !== alert.agentId) return false;
        if (alert.scope === "tool" && a.toolName !== alert.toolName) return false;
        return true;
      };
      // Find an existing match and update in place (mirrors DO UPDATE
      // SET budget_usd / spent_usd / recorded_at on the partial unique
      // index). If no match, insert keyed by alert.id.
      for (const [key, existing] of bucket.entries()) {
        if (matchKey(existing)) {
          bucket.set(key, {
            ...existing,
            budgetUsd: alert.budgetUsd,
            spentUsd: alert.spentUsd,
            recordedAt: alert.recordedAt,
          });
          return;
        }
      }
      bucket.set(alert.id, { ...alert });
      return;
    }
    await withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      await upsertBudgetAlertRow(client, ctx, alert);
    });
  },

  /**
   * DASH-64.7: persist a provisioned company (company + workspace +
   * fingerprint + optional secretBindings). Production routes through
   * Postgres via withWorkspaceContext (companies table); test mode
   * buckets by tenantWorkspaceId in memCompanies.
   */
  async upsertProvisionedCompany(
    ctx: ControlPlaneRepoContext,
    input: {
      company: ProvisionedCompanyRecord;
      workspace: ProvisionedCompanyWorkspace;
      tenantWorkspaceId: string;
      fingerprint?: string;
      secretBindings?: Record<string, string>;
    }
  ): Promise<void> {
    if (useInMemoryFallback()) {
      const bucket = memBucket(memCompanies, input.tenantWorkspaceId);
      bucket.set(input.company.id, {
        company: { ...input.company },
        workspace: { ...input.workspace },
        tenantWorkspaceId: input.tenantWorkspaceId,
        fingerprint: input.fingerprint ?? "",
        secretBindings: { ...(input.secretBindings ?? {}) },
      });
      return;
    }
    await withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      await upsertCompanyRowInClient(client, {
        company: input.company,
        workspace: input.workspace,
        tenantWorkspaceId: input.tenantWorkspaceId,
      });
    });
  },

  async getProvisionedCompany(
    ctx: ControlPlaneRepoContext,
    companyId: string,
  ): Promise<MemCompanyEntry | undefined> {
    if (useInMemoryFallback()) {
      const bucket = memBucket(memCompanies, ctx.workspaceId);
      const entry = bucket.get(companyId);
      if (entry) {
        return {
          company: { ...entry.company },
          workspace: { ...entry.workspace },
          tenantWorkspaceId: entry.tenantWorkspaceId,
          fingerprint: entry.fingerprint,
          secretBindings: { ...entry.secretBindings },
        };
      }
      // Cross-workspace fallback (test mode legacy behaviour).
      for (const b of memCompanies.values()) {
        const found = b.get(companyId);
        if (found) {
          return {
            company: { ...found.company },
            workspace: { ...found.workspace },
            tenantWorkspaceId: found.tenantWorkspaceId,
            fingerprint: found.fingerprint,
            secretBindings: { ...found.secretBindings },
          };
        }
      }
      return undefined;
    }
    return withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      const result = await client.query<CompanyRow>(
        `SELECT id, workspace_id, user_id, name, external_company_id,
                provisioned_workspace_id, provisioned_workspace_name, provisioned_workspace_slug,
                team_id, idempotency_key, budget_monthly_usd, allocated_budget_monthly_usd,
                remaining_budget_monthly_usd, created_at, updated_at
           FROM companies
          WHERE id = $1`,
        [companyId]
      );
      const row = result.rows[0];
      if (!row) return undefined;
      const hydrated = rowToProvisionedCompany(row);
      // Production secret bindings live in secretsRepository; this
      // helper returns the row metadata only.
      return { ...hydrated, fingerprint: "", secretBindings: {} };
    });
  },

  /**
   * DASH-64.7: list every provisioned company in the given workspace
   * regardless of caller userId. Used by listAccessibleTeamIds so a
   * second identity in the workspace can see teams provisioned by
   * other users in the same workspace. Workspace RLS is the access
   * boundary in production; the in-memory fallback mirrors that by
   * bucketing memCompanies by tenantWorkspaceId.
   */
  async listCompaniesInWorkspace(ctx: ControlPlaneRepoContext): Promise<MemCompanyEntry[]> {
    if (useInMemoryFallback()) {
      const bucket = memBucket(memCompanies, ctx.workspaceId);
      return Array.from(bucket.values()).map((entry) => ({
        company: { ...entry.company },
        workspace: { ...entry.workspace },
        tenantWorkspaceId: entry.tenantWorkspaceId,
        fingerprint: entry.fingerprint,
        secretBindings: { ...entry.secretBindings },
      }));
    }
    return withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      const result = await client.query<CompanyRow>(
        `SELECT id, workspace_id, user_id, name, external_company_id,
                provisioned_workspace_id, provisioned_workspace_name, provisioned_workspace_slug,
                team_id, idempotency_key, budget_monthly_usd, allocated_budget_monthly_usd,
                remaining_budget_monthly_usd, created_at, updated_at
           FROM companies`,
        []
      );
      return result.rows.map((row) => {
        const hydrated = rowToProvisionedCompany(row);
        return { ...hydrated, fingerprint: "", secretBindings: {} };
      });
    });
  },

  /**
   * DASH-64.7: cross-workspace fallback for legacy callers without a
   * pinned workspaceId. Migration 051 SECURITY DEFINER helper.
   */
  async listAllProvisionedCompaniesForUser(userId: string): Promise<MemCompanyEntry[]> {
    if (useInMemoryFallback()) {
      const out: MemCompanyEntry[] = [];
      for (const bucket of memCompanies.values()) {
        for (const entry of bucket.values()) {
          if (entry.company.userId === userId) {
            out.push({
              company: { ...entry.company },
              workspace: { ...entry.workspace },
              tenantWorkspaceId: entry.tenantWorkspaceId,
              fingerprint: entry.fingerprint,
              secretBindings: { ...entry.secretBindings },
            });
          }
        }
      }
      return out.sort((left, right) => left.company.createdAt.localeCompare(right.company.createdAt));
    }
    const pool = getPostgresPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      const result = await client.query<CompanyRow>(
        `SELECT id, workspace_id, user_id, name, external_company_id,
                provisioned_workspace_id, provisioned_workspace_name, provisioned_workspace_slug,
                team_id, idempotency_key, budget_monthly_usd, allocated_budget_monthly_usd,
                remaining_budget_monthly_usd, created_at, updated_at
           FROM list_companies_for_user($1)`,
        [userId]
      );
      await client.query("COMMIT");
      return result.rows.map((row) => {
        const hydrated = rowToProvisionedCompany(row);
        return { ...hydrated, fingerprint: "", secretBindings: {} };
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * DASH-64.6: persist (insert or update) a team row. Production routes
   * through Postgres via withWorkspaceContext; test mode buckets by
   * workspace in memTeams. companyId is optional — callers that have a
   * teamCompanyIds mapping pass it explicitly so the foreign-key column
   * stays in sync.
   */
  async upsertTeam(
    ctx: ControlPlaneRepoContext,
    team: ControlPlaneTeam,
    companyId: string | null = null
  ): Promise<void> {
    if (useInMemoryFallback()) {
      memBucket(memTeams, ctx.workspaceId).set(team.id, { ...team });
      return;
    }
    await withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      await upsertTeamRowInClient(client, ctx, team, companyId);
    });
  },

  /**
   * DASH-64.6: single-team lookup. Mirrors getAgent — returns a copy
   * the caller can mutate freely; persistence requires a follow-up
   * upsertTeam.
   */
  async getTeam(
    ctx: ControlPlaneRepoContext,
    teamId: string
  ): Promise<ControlPlaneTeam | undefined> {
    if (useInMemoryFallback()) {
      const inWorkspace = memBucket(memTeams, ctx.workspaceId).get(teamId);
      if (inWorkspace) return { ...inWorkspace };
      for (const bucket of memTeams.values()) {
        const team = bucket.get(teamId);
        if (team) return { ...team };
      }
      return undefined;
    }
    return withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      const result = await client.query<TeamRow>(
        `SELECT id, workspace_id, user_id, company_id, name, description,
                workflow_template_id, workflow_template_name, deployment_mode,
                status, paused_by_company_lifecycle, restart_count,
                budget_monthly_usd, tool_budget_ceilings, alert_thresholds,
                orchestration_enabled, last_heartbeat_at,
                created_at, updated_at
           FROM agent_teams
          WHERE id = $1`,
        [teamId]
      );
      const row = result.rows[0];
      return row ? rowToTeam(row) : undefined;
    });
  },

  /**
   * DASH-64.8: lightweight workspace-id lookup for a team. Replaces the
   * `teamWorkspaceIds` in-memory cache. In test mode, scans all
   * memTeams buckets to find the team's home workspace. In production,
   * calls the existing `lookup_team_workspace_id` SECURITY DEFINER
   * helper (migration 030).
   */
  async getTeamWorkspaceId(teamId: string): Promise<string | undefined> {
    if (useInMemoryFallback()) {
      for (const [workspaceId, bucket] of memTeams.entries()) {
        if (bucket.has(teamId)) return workspaceId;
      }
      return undefined;
    }
    const pool = getPostgresPool();
    const client = await pool.connect();
    try {
      const result = await client.query<{ workspace_id: string | null }>(
        `SELECT lookup_team_workspace_id($1) AS workspace_id`,
        [teamId]
      );
      const row = result.rows[0];
      return row?.workspace_id ?? undefined;
    } finally {
      client.release();
    }
  },

  async listTeams(
    ctx: ControlPlaneRepoContext,
    filters?: { userId?: string }
  ): Promise<ControlPlaneTeam[]> {
    if (useInMemoryFallback()) {
      // DASH-64.6: workspace IS the access boundary (RLS analogue) —
      // no userId filter unless explicitly requested (matches the
      // pre-DASH-64.6 listAccessibleTeamIds where teams in the same
      // workspace are accessible regardless of agent.userId, gated by
      // workspace membership).
      const bucket = memBucket(memTeams, ctx.workspaceId);
      const rows = Array.from(bucket.values()).filter((team) => {
        if (filters?.userId && team.userId !== filters.userId) return false;
        return true;
      });
      return rows
        .map((team) => ({ ...team }))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    }
    return withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      const params: unknown[] = [];
      const conditions: string[] = [];
      if (filters?.userId) {
        params.push(filters.userId);
        conditions.push(`user_id = $${params.length}`);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const result = await client.query<TeamRow>(
        `SELECT id, workspace_id, user_id, company_id, name, description,
                workflow_template_id, workflow_template_name, deployment_mode,
                status, paused_by_company_lifecycle, restart_count,
                budget_monthly_usd, tool_budget_ceilings, alert_thresholds,
                orchestration_enabled, last_heartbeat_at,
                created_at, updated_at
           FROM agent_teams
          ${where}
          ORDER BY created_at ASC`,
        params
      );
      return result.rows.map(rowToTeam);
    });
  },

  /**
   * DASH-64.6: cross-workspace fallback for legacy callers without a
   * pinned workspaceId. Migration 050 SECURITY DEFINER helper, bound
   * to app.current_user_id (matches 046/047/048/049 pattern).
   */
  async listAllTeamsForUser(userId: string): Promise<ControlPlaneTeam[]> {
    if (useInMemoryFallback()) {
      const out: ControlPlaneTeam[] = [];
      for (const bucket of memTeams.values()) {
        for (const team of bucket.values()) {
          if (team.userId === userId) out.push({ ...team });
        }
      }
      return out.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    }
    const pool = getPostgresPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      const result = await client.query<TeamRow>(
        `SELECT id, workspace_id, user_id, company_id, name, description,
                workflow_template_id, workflow_template_name, deployment_mode,
                status, paused_by_company_lifecycle, restart_count,
                budget_monthly_usd, tool_budget_ceilings, alert_thresholds,
                orchestration_enabled, last_heartbeat_at,
                created_at, updated_at
           FROM list_teams_for_user($1)`,
        [userId]
      );
      await client.query("COMMIT");
      return result.rows.map(rowToTeam);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * DASH-64.5: persist (insert or update) an agent row. Mirrors
   * upsertExecution: production routes through Postgres via
   * withWorkspaceContext, test mode buckets by workspace in memAgents.
   * Callers mutate the agent record locally and call this to persist.
   */
  async upsertAgent(
    ctx: ControlPlaneRepoContext,
    agent: ControlPlaneAgent
  ): Promise<void> {
    if (useInMemoryFallback()) {
      memBucket(memAgents, ctx.workspaceId).set(agent.id, { ...agent });
      return;
    }
    await withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      await upsertAgentRowInClient(client, ctx, agent);
    });
  },

  /**
   * DASH-64.5: single-agent lookup, mirrors getExecution. Returns a copy
   * the caller can mutate freely; persistence requires a follow-up
   * upsertAgent. RLS in production / workspaceId bucket in tests
   * provides the access boundary.
   */
  async getAgent(
    ctx: ControlPlaneRepoContext,
    agentId: string
  ): Promise<ControlPlaneAgent | undefined> {
    if (useInMemoryFallback()) {
      const inWorkspace = memBucket(memAgents, ctx.workspaceId).get(agentId);
      if (inWorkspace) return { ...inWorkspace };
      // DASH-64.5: same cross-workspace fallback shape as getTask /
      // getExecution. Production RLS makes this branch unreachable.
      for (const bucket of memAgents.values()) {
        const agent = bucket.get(agentId);
        if (agent) return { ...agent };
      }
      return undefined;
    }
    return withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      const result = await client.query<AgentRow>(
        `SELECT id, workspace_id, team_id, user_id, name, role_key,
                workflow_step_id, workflow_step_kind, model, instructions,
                budget_monthly_usd, reporting_to_agent_id, skills, schedule,
                status, paused_by_company_lifecycle, current_execution_id,
                last_heartbeat_at, last_heartbeat_status,
                created_at, updated_at
           FROM agents
          WHERE id = $1`,
        [agentId]
      );
      const row = result.rows[0];
      return row ? rowToAgent(row) : undefined;
    });
  },

  async listAgents(
    ctx: ControlPlaneRepoContext,
    filters?: { teamId?: string; status?: AgentLifecycleStatus }
  ): Promise<ControlPlaneAgent[]> {
    if (useInMemoryFallback()) {
      // DASH-64.5: workspace IS the access boundary (RLS analogue) —
      // no userId filter. Mirrors the pre-DASH-64.5 in-memory listAgents
      // which only filtered by teamId (canAccessTeam handled access).
      const bucket = memBucket(memAgents, ctx.workspaceId);
      const rows = Array.from(bucket.values()).filter((agent) => {
        if (filters?.teamId && agent.teamId !== filters.teamId) return false;
        if (filters?.status && agent.status !== filters.status) return false;
        return true;
      });
      return rows
        .map((agent) => ({ ...agent }))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    }
    return withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      // DASH-64.5: no user_id filter — workspace RLS is the access
      // boundary (same pattern as DASH-64.1 listTasks).
      const params: unknown[] = [];
      const conditions: string[] = [];
      if (filters?.teamId) {
        params.push(filters.teamId);
        conditions.push(`team_id = $${params.length}`);
      }
      if (filters?.status) {
        params.push(filters.status);
        conditions.push(`status = $${params.length}`);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const result = await client.query<AgentRow>(
        `SELECT id, workspace_id, team_id, user_id, name, role_key,
                workflow_step_id, workflow_step_kind, model, instructions,
                budget_monthly_usd, reporting_to_agent_id, skills, schedule,
                status, paused_by_company_lifecycle, current_execution_id,
                last_heartbeat_at, last_heartbeat_status,
                created_at, updated_at
           FROM agents
          ${where}
          ORDER BY created_at ASC`,
        params
      );
      return result.rows.map(rowToAgent);
    });
  },

  /**
   * DASH-64.5: workspace-less fallback for legacy callers that have a
   * userId but no resolved workspaceId (cross-workspace dashboards).
   * Same pattern as listAllTasksForUser → migration 049 SECURITY
   * DEFINER helper, bound to app.current_user_id.
   */
  async listAllAgentsForUser(userId: string): Promise<ControlPlaneAgent[]> {
    if (useInMemoryFallback()) {
      const out: ControlPlaneAgent[] = [];
      for (const bucket of memAgents.values()) {
        for (const agent of bucket.values()) {
          if (agent.userId === userId) out.push({ ...agent });
        }
      }
      return out.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    }
    const pool = getPostgresPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      const result = await client.query<AgentRow>(
        `SELECT id, workspace_id, team_id, user_id, name, role_key,
                workflow_step_id, workflow_step_kind, model, instructions,
                budget_monthly_usd, reporting_to_agent_id, skills, schedule,
                status, paused_by_company_lifecycle, current_execution_id,
                last_heartbeat_at, last_heartbeat_status,
                created_at, updated_at
           FROM list_agents_for_user($1)`,
        [userId]
      );
      await client.query("COMMIT");
      return result.rows.map(rowToAgent);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * DASH-64.4: persist (insert or update) an execution row. Used by every
   * write-side mutator in controlPlaneStore (startAgentExecution,
   * finalizeAgentExecution, recordHeartbeat, updateExecutionLifecycle,
   * updateAgentLifecycle stop/restart, updateAgentSkills, budget-driven
   * pause). Test-mode in-memory fallback stores a deep copy so callers
   * can mutate the returned snapshot without polluting the source row.
   */
  async upsertExecution(
    ctx: ControlPlaneRepoContext,
    execution: ControlPlaneExecution
  ): Promise<void> {
    if (useInMemoryFallback()) {
      memBucket(memExecutions, ctx.workspaceId).set(execution.id, { ...execution });
      return;
    }
    await withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      await upsertExecutionRow(client, ctx, execution);
    });
  },

  /**
   * DASH-64.4: single-execution lookup. Returns a copy of the stored row
   * so callers can mutate freely; persistence requires a follow-up
   * `upsertExecution`. RLS in production / workspaceId bucket in tests
   * provides the access boundary.
   */
  async getExecution(
    ctx: ControlPlaneRepoContext,
    executionId: string
  ): Promise<ControlPlaneExecution | undefined> {
    if (useInMemoryFallback()) {
      const inWorkspace = memBucket(memExecutions, ctx.workspaceId).get(executionId);
      if (inWorkspace) return { ...inWorkspace };
      // DASH-64.4: same fallback shape as getTask — test callers that
      // haven't wired workspace context still need to find their row
      // (production RLS makes this branch unreachable).
      for (const bucket of memExecutions.values()) {
        const execution = bucket.get(executionId);
        if (execution) return { ...execution };
      }
      return undefined;
    }
    return withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      const result = await client.query<ExecutionRow>(
        `SELECT id, workspace_id, team_id, user_id, agent_id, source_run_id,
                source_workflow_step_id, source_workflow_step_name, task_id, status,
                applied_skills, metadata, summary, cost_usd,
                requested_at, started_at, completed_at, last_heartbeat_at, restart_count
           FROM agent_executions
          WHERE id = $1`,
        [executionId]
      );
      const row = result.rows[0];
      return row ? rowToExecution(row) : undefined;
    });
  },

  async listExecutions(
    ctx: ControlPlaneRepoContext,
    filters?: { teamId?: string; agentId?: string; status?: ControlPlaneExecutionStatus }
  ): Promise<ControlPlaneExecution[]> {
    if (useInMemoryFallback()) {
      const bucket = memBucket(memExecutions, ctx.workspaceId);
      let rows = Array.from(bucket.values()).filter((execution) => {
        if (filters?.teamId && execution.teamId !== filters.teamId) return false;
        if (filters?.agentId && execution.agentId !== filters.agentId) return false;
        if (filters?.status && execution.status !== filters.status) return false;
        return true;
      });
      // DASH-64.4: cross-workspace fallback for test-mode callers that
      // haven't wired workspace context. Mirrors listHeartbeats fallback.
      if (rows.length === 0 && memExecutions.size > 1) {
        const all: ControlPlaneExecution[] = [];
        for (const b of memExecutions.values()) {
          for (const execution of b.values()) {
            if (execution.userId !== ctx.userId) continue;
            if (filters?.teamId && execution.teamId !== filters.teamId) continue;
            if (filters?.agentId && execution.agentId !== filters.agentId) continue;
            if (filters?.status && execution.status !== filters.status) continue;
            all.push(execution);
          }
        }
        rows = all;
      }
      return rows
        .map((execution) => ({ ...execution }))
        .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
    }
    return withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      const params: unknown[] = [ctx.userId];
      let where = "user_id = $1";
      if (filters?.teamId) {
        params.push(filters.teamId);
        where += ` AND team_id = $${params.length}`;
      }
      if (filters?.agentId) {
        params.push(filters.agentId);
        where += ` AND agent_id = $${params.length}`;
      }
      if (filters?.status) {
        params.push(filters.status);
        where += ` AND status = $${params.length}`;
      }
      const result = await client.query<ExecutionRow>(
        `SELECT id, workspace_id, team_id, user_id, agent_id, source_run_id,
                source_workflow_step_id, source_workflow_step_name, task_id, status,
                applied_skills, metadata, summary, cost_usd,
                requested_at, started_at, completed_at, last_heartbeat_at, restart_count
           FROM agent_executions
          WHERE ${where}
          ORDER BY requested_at ASC`,
        params
      );
      return result.rows.map(rowToExecution);
    });
  },

  /**
   * DASH-64.4: workspace-less fallback for legacy callers that have a
   * userId but no resolved workspaceId. Same pattern as
   * listAllTasksForUser / listAllHeartbeatsForUser → migration 048
   * SECURITY DEFINER helper (RLS bypass scoped to user_id filter, with
   * the helper bound to `app.current_user_id` for defense-in-depth).
   */
  async listAllExecutionsForUser(userId: string): Promise<ControlPlaneExecution[]> {
    if (useInMemoryFallback()) {
      const out: ControlPlaneExecution[] = [];
      for (const bucket of memExecutions.values()) {
        for (const execution of bucket.values()) {
          if (execution.userId === userId) out.push({ ...execution });
        }
      }
      return out.sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
    }
    const pool = getPostgresPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      const result = await client.query<ExecutionRow>(
        `SELECT id, workspace_id, team_id, user_id, agent_id, source_run_id,
                source_workflow_step_id, source_workflow_step_name, task_id, status,
                applied_skills, metadata, summary, cost_usd,
                requested_at, started_at, completed_at, last_heartbeat_at, restart_count
           FROM list_agent_executions_for_user($1)`,
        [userId]
      );
      await client.query("COMMIT");
      return result.rows.map(rowToExecution);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },

  async listBudgetAlerts(
    ctx: ControlPlaneRepoContext,
    filters?: { teamId?: string }
  ): Promise<ControlPlaneBudgetAlert[]> {
    if (useInMemoryFallback()) {
      const bucket = memBucket(memBudgetAlerts, ctx.workspaceId);
      return Array.from(bucket.values())
        .filter((alert) => {
          if (filters?.teamId && alert.teamId !== filters.teamId) return false;
          return true;
        })
        .map((alert) => ({ ...alert }))
        .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
    }
    return withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      const params: unknown[] = [ctx.userId];
      let where = "user_id = $1";
      if (filters?.teamId) {
        params.push(filters.teamId);
        where += ` AND team_id = $${params.length}`;
      }
      const result = await client.query<BudgetAlertRow>(
        `SELECT id, team_id, user_id, agent_id, tool_name, scope, threshold,
                budget_usd, spent_usd, recorded_at
           FROM budget_alerts
          WHERE ${where}
          ORDER BY recorded_at DESC`,
        params
      );
      return result.rows.map(rowToBudgetAlert);
    });
  },
};

/**
 * DASH-64.1: Test-only — clears the in-memory fallback stores so each
 * `beforeEach` starts from a clean slate. No-op in production (Postgres
 * is the source of truth and test fixtures handle their own teardown).
 *
 * Exported separately from the main `controlPlaneRepository` object so
 * production code can't accidentally call it.
 */
export function __resetRepositoryInMemoryStateForTests(): void {
  memTasks.clear();
  memHeartbeats.clear();
  memSpendEntries.clear();
  memBudgetAlerts.clear();
  memExecutions.clear();
  memAgents.clear();
  memTeams.clear();
  memCompanies.clear();
}

export type ControlPlaneRepository = typeof controlPlaneRepository;
