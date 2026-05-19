import express from "express";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { recordControlPlaneAudit, recordControlPlaneAuditBatch } from "../auditing/controlPlaneAudit";
import { getPostgresPool, inMemoryAllowed, isPostgresPersistenceEnabled } from "../db/postgres";
import { requireEntitlement } from "../middleware/requireEntitlement";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import { getTemplate } from "../templates";
import type {
  AgentLifecycleStatus,
  ControlPlaneAgent,
  ControlPlaneTeam,
  TeamDeploymentMode,
  TeamLifecycleStatus,
} from "./types";
import { WorkflowTemplate } from "../types/workflow";
import { controlPlaneStore } from "./controlPlaneStore";

const router = express.Router();

function parseToolBudgetCeilings(value: unknown): Record<string, number> | null {
  if (value === undefined) {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const entries = Object.entries(value);
  const parsed = Object.fromEntries(
    entries.map(([key, amount]) => [key.trim(), amount])
  );
  for (const [toolName, amount] of Object.entries(parsed)) {
    if (!toolName || typeof amount !== "number" || amount < 0) {
      return null;
    }
  }
  return parsed as Record<string, number>;
}

function parseAlertThresholds(value: unknown): number[] | null {
  if (value === undefined) {
    return [0.8, 0.9, 1];
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "number" || entry <= 0 || entry > 1)) {
    return null;
  }
  return Array.from(new Set(value)).sort((left, right) => left - right) as number[];
}

function parseSpendEntries(value: unknown): Array<{
  category: "llm" | "tool" | "api" | "compute" | "ad_spend" | "third_party";
  costUsd: number;
  model?: string;
  provider?: string;
  toolName?: string;
  metadata?: Record<string, unknown>;
}> | null {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }

  const parsed: Array<{
    category: "llm" | "tool" | "api" | "compute" | "ad_spend" | "third_party";
    costUsd: number;
    model?: string;
    provider?: string;
    toolName?: string;
    metadata?: Record<string, unknown>;
  }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }
    const candidate = entry as Record<string, unknown>;
    if (
      candidate.category !== "llm" &&
      candidate.category !== "tool" &&
      candidate.category !== "api" &&
      candidate.category !== "compute" &&
      candidate.category !== "ad_spend" &&
      candidate.category !== "third_party"
    ) {
      return null;
    }
    if (typeof candidate.costUsd !== "number" || candidate.costUsd < 0) {
      return null;
    }
    if (candidate.toolName !== undefined && (typeof candidate.toolName !== "string" || !candidate.toolName.trim())) {
      return null;
    }
    parsed.push({
      category: candidate.category,
      costUsd: candidate.costUsd,
      model: typeof candidate.model === "string" ? candidate.model : undefined,
      provider: typeof candidate.provider === "string" ? candidate.provider : undefined,
      toolName: typeof candidate.toolName === "string" ? candidate.toolName.trim() : undefined,
      metadata:
        candidate.metadata && typeof candidate.metadata === "object" && !Array.isArray(candidate.metadata)
          ? (candidate.metadata as Record<string, unknown>)
          : undefined,
    });
  }
  return parsed;
}

function getUserId(req: AuthenticatedRequest): string | null {
  const userId = req.auth?.sub;
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

function resolveWorkspaceContext(req: WorkspaceAwareRequest, res: express.Response) {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return null;
  }

  const workspaceId = req.workspaceId?.trim();
  if (workspaceId) {
    return { workspaceId, userId };
  }

  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return { workspaceId: undefined, userId };
  }
  if (isPostgresPersistenceEnabled()) {
    res.status(500).json({ error: "Workspace context was not resolved for the request" });
    return null;
  }
  if (inMemoryAllowed()) {
    return { workspaceId: userId, userId };
  }

  res.status(500).json({ error: "Workspace context was not resolved for the request" });
  return null;
}

/**
 * DASH-40: load a team + its agents directly from the canonical Postgres
 * tables for the active workspace, scoped through `withWorkspaceContext`
 * so RLS applies. Mirrors the DASH-27 `loadCanonicalAgents` pattern used
 * by GET /api/agents. Returns null when no row matches the id/workspace
 * pair; throws on Postgres connectivity errors so the caller can decide
 * whether to 404 or 500.
 *
 * The mapper fills the in-memory ControlPlaneTeam / ControlPlaneAgent
 * shape so the rest of the route handler stays uniform. Runtime-only
 * fields (lastHeartbeatStatus, currentExecutionId, schedule beyond the
 * stored cron/interval) default to safe values — the dashboard already
 * tolerates them being absent on canonical-only teams.
 */
async function loadCanonicalTeamDetail(
  teamId: string,
  workspaceId: string,
  userId: string,
): Promise<{ team: ControlPlaneTeam; agents: ControlPlaneAgent[] } | null> {
  interface TeamRow {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    workflow_template_id: string | null;
    workflow_template_name: string | null;
    deployment_mode: TeamDeploymentMode;
    status: TeamLifecycleStatus;
    paused_by_company_lifecycle: boolean;
    restart_count: number | string;
    last_heartbeat_at: Date | string | null;
    budget_monthly_usd: string | number;
    tool_budget_ceilings: Record<string, number> | string | null;
    alert_thresholds: number[] | string | null;
    orchestration_enabled: boolean;
    created_at: Date | string;
    updated_at: Date | string;
  }

  interface AgentRow {
    id: string;
    team_id: string;
    user_id: string;
    name: string;
    role_key: string;
    model: string | null;
    instructions: string | null;
    budget_monthly_usd: string | number;
    reporting_to_agent_id: string | null;
    status: AgentLifecycleStatus;
    last_heartbeat_at: Date | string | null;
    created_at: Date | string;
    updated_at: Date | string;
  }

  const pool = getPostgresPool();
  return withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
    const teamResult = await client.query<TeamRow>(
      `SELECT id, user_id, name, description, workflow_template_id,
              workflow_template_name, deployment_mode, status,
              paused_by_company_lifecycle, restart_count, last_heartbeat_at,
              budget_monthly_usd, tool_budget_ceilings, alert_thresholds,
              orchestration_enabled, created_at, updated_at
         FROM agent_teams
        WHERE id = $1 AND workspace_id = $2`,
      [teamId, workspaceId],
    );
    if (teamResult.rowCount === 0) {
      return null;
    }
    const row = teamResult.rows[0];

    const parseJsonField = <T>(value: unknown, fallback: T): T => {
      if (value === null || value === undefined) return fallback;
      if (typeof value === "string") {
        try {
          return JSON.parse(value) as T;
        } catch {
          return fallback;
        }
      }
      return value as T;
    };

    const isoOrNull = (v: Date | string | null | undefined): string | undefined => {
      if (v === null || v === undefined) return undefined;
      return v instanceof Date ? v.toISOString() : v;
    };

    const team: ControlPlaneTeam = {
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
      pausedByCompanyLifecycle: row.paused_by_company_lifecycle,
      restartCount: Number(row.restart_count),
      lastHeartbeatAt: isoOrNull(row.last_heartbeat_at),
      budgetMonthlyUsd: Number(row.budget_monthly_usd),
      toolBudgetCeilings: parseJsonField<Record<string, number>>(row.tool_budget_ceilings, {}),
      alertThresholds: parseJsonField<number[]>(row.alert_thresholds, [0.8, 0.9, 1]),
      orchestrationEnabled: row.orchestration_enabled,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    };

    const agentResult = await client.query<AgentRow>(
      `SELECT id, team_id, user_id, name, role_key, model, instructions,
              budget_monthly_usd, reporting_to_agent_id, status,
              last_heartbeat_at, created_at, updated_at
         FROM agents
        WHERE team_id = $1 AND workspace_id = $2
        ORDER BY created_at ASC`,
      [teamId, workspaceId],
    );

    const agents: ControlPlaneAgent[] = agentResult.rows.map((agentRow) => ({
      id: agentRow.id,
      teamId: agentRow.team_id,
      userId: agentRow.user_id,
      name: agentRow.name,
      roleKey: agentRow.role_key,
      model: agentRow.model ?? undefined,
      instructions: agentRow.instructions ?? "",
      budgetMonthlyUsd: Number(agentRow.budget_monthly_usd),
      reportingToAgentId: agentRow.reporting_to_agent_id ?? undefined,
      skills: [],
      schedule: { type: "manual" },
      status: agentRow.status,
      lastHeartbeatAt: isoOrNull(agentRow.last_heartbeat_at),
      createdAt:
        agentRow.created_at instanceof Date
          ? agentRow.created_at.toISOString()
          : agentRow.created_at,
      updatedAt:
        agentRow.updated_at instanceof Date
          ? agentRow.updated_at.toISOString()
          : agentRow.updated_at,
    }));

    return { team, agents };
  });
}

function requirePaperclipRunId(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const runId = req.header("X-Paperclip-Run-Id");
  if (!runId || !runId.trim()) {
    res.status(400).json({ error: "X-Paperclip-Run-Id header is required for mutating control-plane requests" });
    return;
  }
  next();
}

router.get("/teams", (req: WorkspaceAwareRequest, res) => {
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }

  const teams = controlPlaneStore.listTeams(context.userId, context.workspaceId);
  res.json({ teams, total: teams.length });
});

router.get("/company/lifecycle", async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const state = await controlPlaneStore.getCompanyLifecycle(userId);
  res.json(state);
});

router.get("/company/lifecycle/audit", async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const auditTrail = await controlPlaneStore.listCompanyLifecycleAudit(userId);
  res.json({ auditTrail, total: auditTrail.length });
});

router.post("/company/lifecycle", requirePaperclipRunId, async (req: WorkspaceAwareRequest, res) => {
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }
  const workspaceId = context.workspaceId;
  if (!workspaceId) {
    res.status(500).json({ error: "Workspace context was not resolved for the request" });
    return;
  }

  const { action, reason } = req.body as { action?: unknown; reason?: unknown };
  if (action !== "pause" && action !== "resume") {
    res.status(400).json({ error: "action must be pause or resume" });
    return;
  }
  if (reason !== undefined && typeof reason !== "string") {
    res.status(400).json({ error: "reason must be a string when provided" });
    return;
  }

  const result = await controlPlaneStore.updateCompanyLifecycle({
    userId: context.userId,
    action,
    actor: req.header("X-Paperclip-Run-Id") as string,
    reason: typeof reason === "string" ? reason : undefined,
  });

  await recordControlPlaneAudit({
    workspaceId,
    userId: context.userId,
    category: "team_lifecycle",
    action: action === "pause" ? "company_paused" : "company_resumed",
    target: { type: "workspace", id: workspaceId },
    metadata: {
      runId: req.header("X-Paperclip-Run-Id"),
      reason: typeof reason === "string" ? reason : null,
      affectedTeamIds: result.affectedTeamIds,
      affectedAgentIds: result.affectedAgentIds,
    },
  });
  res.json(result);
});

router.get("/skills", (_req, res) => {
  const skills = controlPlaneStore.listSkills();
  res.json({ skills, total: skills.length });
});

router.post("/teams", requirePaperclipRunId, async (req: WorkspaceAwareRequest, res) => {
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }

  const { name, description, budgetMonthlyUsd, toolBudgetCeilings, alertThresholds, deploymentMode, orchestrationEnabled } = req.body as {
    name?: unknown;
    description?: unknown;
    budgetMonthlyUsd?: unknown;
    toolBudgetCeilings?: unknown;
    alertThresholds?: unknown;
    deploymentMode?: unknown;
    orchestrationEnabled?: unknown;
  };

  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required and must be a non-empty string" });
    return;
  }

  if (budgetMonthlyUsd !== undefined && (typeof budgetMonthlyUsd !== "number" || budgetMonthlyUsd < 0)) {
    res.status(400).json({ error: "budgetMonthlyUsd must be a non-negative number when provided" });
    return;
  }
  const parsedToolBudgetCeilings = parseToolBudgetCeilings(toolBudgetCeilings);
  if (!parsedToolBudgetCeilings) {
    res.status(400).json({ error: "toolBudgetCeilings must be an object of non-negative numbers when provided" });
    return;
  }
  const parsedAlertThresholds = parseAlertThresholds(alertThresholds);
  if (!parsedAlertThresholds) {
    res.status(400).json({ error: "alertThresholds must be an array of numbers between 0 and 1 when provided" });
    return;
  }

  const team = await controlPlaneStore.createTeam({
    workspaceId: context.workspaceId,
    userId: context.userId,
    name: name.trim(),
    description: typeof description === "string" ? description : undefined,
    budgetMonthlyUsd: typeof budgetMonthlyUsd === "number" ? budgetMonthlyUsd : undefined,
    toolBudgetCeilings: parsedToolBudgetCeilings,
    alertThresholds: parsedAlertThresholds,
    deploymentMode:
      deploymentMode === "workflow_runtime" || deploymentMode === "continuous_agents"
        ? deploymentMode
        : undefined,
    orchestrationEnabled:
      typeof orchestrationEnabled === "boolean" ? orchestrationEnabled : undefined,
  });

  await recordControlPlaneAudit({
    workspaceId: context.workspaceId,
    userId: context.userId,
    category: "team_lifecycle",
    action: "team_created",
    target: { type: "team", id: team.id },
    metadata: {
      runId: req.header("X-Paperclip-Run-Id"),
      deploymentMode: team.deploymentMode,
      orchestrationEnabled: team.orchestrationEnabled,
    },
  });

  res.status(201).json(team);
});

router.post(
  "/deployments/workflow",
  requirePaperclipRunId,
  requireEntitlement("agentCap", {
    getCurrent: (req) => {
      const userId = (req as AuthenticatedRequest).auth?.sub ?? "";
      return controlPlaneStore.listAllAgents(userId, req.workspace?.id).length;
    },
    delta: 1,
  }),
  async (req: WorkspaceAwareRequest, res) => {
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }

  const { templateId, template: templateDefinition, teamName, budgetMonthlyUsd, toolBudgetCeilings, alertThresholds, defaultIntervalMinutes } = req.body as {
    templateId?: unknown;
    template?: unknown;
    teamName?: unknown;
    budgetMonthlyUsd?: unknown;
    toolBudgetCeilings?: unknown;
    alertThresholds?: unknown;
    defaultIntervalMinutes?: unknown;
  };

  if (
    (typeof templateId !== "string" || !templateId.trim()) &&
    (!templateDefinition || typeof templateDefinition !== "object")
  ) {
    res.status(400).json({ error: "templateId or template is required" });
    return;
  }

  if (budgetMonthlyUsd !== undefined && (typeof budgetMonthlyUsd !== "number" || budgetMonthlyUsd < 0)) {
    res.status(400).json({ error: "budgetMonthlyUsd must be a non-negative number when provided" });
    return;
  }
  const parsedToolBudgetCeilings = parseToolBudgetCeilings(toolBudgetCeilings);
  if (!parsedToolBudgetCeilings) {
    res.status(400).json({ error: "toolBudgetCeilings must be an object of non-negative numbers when provided" });
    return;
  }
  const parsedAlertThresholds = parseAlertThresholds(alertThresholds);
  if (!parsedAlertThresholds) {
    res.status(400).json({ error: "alertThresholds must be an array of numbers between 0 and 1 when provided" });
    return;
  }

  if (
    defaultIntervalMinutes !== undefined &&
    (typeof defaultIntervalMinutes !== "number" || defaultIntervalMinutes <= 0)
  ) {
    res.status(400).json({ error: "defaultIntervalMinutes must be a positive number when provided" });
    return;
  }

  try {
    const template =
      typeof templateId === "string" && templateId.trim()
        ? getTemplate(templateId)
        : (templateDefinition as WorkflowTemplate);
    const deployment = await controlPlaneStore.deployWorkflowAsTeam({
      workspaceId: context.workspaceId,
      userId: context.userId,
      template,
      teamName: typeof teamName === "string" ? teamName : undefined,
      budgetMonthlyUsd: typeof budgetMonthlyUsd === "number" ? budgetMonthlyUsd : undefined,
      toolBudgetCeilings: parsedToolBudgetCeilings,
      alertThresholds: parsedAlertThresholds,
      defaultIntervalMinutes:
        typeof defaultIntervalMinutes === "number" ? defaultIntervalMinutes : undefined,
    });

    await recordControlPlaneAuditBatch([
      {
        workspaceId: context.workspaceId,
        userId: context.userId,
        category: "provisioning",
        action: "workflow_team_deployed",
        target: { type: "team", id: deployment.team.id },
        metadata: {
          runId: req.header("X-Paperclip-Run-Id"),
          templateId: deployment.workflow.id,
          templateName: deployment.workflow.name,
          agentCount: deployment.agents.length,
        },
      },
      ...deployment.agents.map((agent) => ({
        workspaceId: context.workspaceId,
        userId: context.userId,
        category: "agent_lifecycle" as const,
        action: "agent_created",
        target: { type: "agent", id: agent.id },
        metadata: {
          runId: req.header("X-Paperclip-Run-Id"),
          teamId: deployment.team.id,
          roleKey: agent.roleKey,
          source: "workflow_deployment",
        },
      })),
    ]);

    res.status(201).json(deployment);
  } catch {
    res.status(404).json({ error: `Template not found: ${templateId}` });
  }
});

router.get("/teams/:id", async (req: WorkspaceAwareRequest, res) => {
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }

  const team = controlPlaneStore.getTeam(req.params.id, context.userId, context.workspaceId);
  if (team) {
    const agents = controlPlaneStore.listAgents(team.id, context.userId, context.workspaceId);
    // DASH-64.1: listTasks is async now.
    // DASH-64.2: listHeartbeats is async now.
    const tasks = await controlPlaneStore.listTasks(context.userId, team.id, context.workspaceId);
    const heartbeats = await controlPlaneStore.listHeartbeats(context.userId, team.id, context.workspaceId);
    const executions = controlPlaneStore.listExecutions(context.userId, team.id, context.workspaceId);
    const spend = controlPlaneStore.getTeamSpendSnapshot(team.id, context.userId, context.workspaceId);
    res.json({ team, agents, tasks, heartbeats, executions, spend });
    return;
  }

  // DASH-40: hiring-plan confirm writes teams + agents directly to Postgres
  // via withWorkspaceContext + raw INSERT — they never land in the legacy
  // in-memory controlPlaneStore. After every Fly restart the in-memory
  // map is empty, so /teams/:id 404'd on any team that was provisioned
  // by hiring-plan confirm rather than the legacy deployWorkflowAsTeam
  // path. Mirrors the DASH-27 fix for GET /api/agents.
  //
  // The runtime-only fields (tasks / heartbeats / executions / spend)
  // don't exist in Postgres yet, so the fallback returns empty arrays
  // for those — the dashboard already tolerates empty arrays. A team
  // that exists in BOTH stores returns the in-memory payload above
  // (richer data); only canonical-only teams take this path.
  if (!isPostgresPersistenceEnabled() || !context.workspaceId) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  try {
    const canonical = await loadCanonicalTeamDetail(
      req.params.id,
      context.workspaceId,
      context.userId,
    );
    if (!canonical) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    res.json({
      team: canonical.team,
      agents: canonical.agents,
      tasks: [],
      heartbeats: [],
      executions: [],
      spend: null,
    });
  } catch (err) {
    console.warn(
      `[controlPlaneRoutes] canonical team lookup failed for ${req.params.id}: ${
        (err as Error).message
      }`,
    );
    res.status(404).json({ error: "Team not found" });
  }
});

router.get("/teams/:id/spend", (req: WorkspaceAwareRequest, res) => {
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }

  const spend = controlPlaneStore.getTeamSpendSnapshot(req.params.id, context.userId, context.workspaceId);
  if (!spend) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  res.json(spend);
});

router.post("/teams/:id/lifecycle", requirePaperclipRunId, async (req: WorkspaceAwareRequest, res) => {
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }

  const { action } = req.body as { action?: unknown };
  if (action !== "pause" && action !== "resume" && action !== "restart" && action !== "stop") {
    res.status(400).json({ error: "action must be one of pause, resume, restart, or stop" });
    return;
  }

  try {
    const team = await controlPlaneStore.updateTeamLifecycle({
      workspaceId: context.workspaceId,
      teamId: req.params.id,
      userId: context.userId,
      action,
    });

    await recordControlPlaneAudit({
      workspaceId: context.workspaceId,
      userId: context.userId,
      category: "team_lifecycle",
      action: `team_${action}`,
      target: { type: "team", id: team.id },
      metadata: {
        runId: req.header("X-Paperclip-Run-Id"),
        status: team.status,
        restartCount: team.restartCount,
      },
    });

    res.json(team);
  } catch (error) {
    if (error instanceof Error && error.message === "team_not_found") {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    res.status(500).json({ error: "Unexpected control-plane lifecycle failure" });
  }
});

router.post("/agents/:id/skills", requirePaperclipRunId, async (req: WorkspaceAwareRequest, res) => {
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }

  const { operation, skills } = req.body as { operation?: unknown; skills?: unknown };
  if (operation !== "assign" && operation !== "revoke") {
    res.status(400).json({ error: "operation must be assign or revoke" });
    return;
  }
  if (!Array.isArray(skills) || skills.some((skill) => typeof skill !== "string" || !skill.trim())) {
    res.status(400).json({ error: "skills must be an array of non-empty strings" });
    return;
  }

  try {
    const agent = await controlPlaneStore.updateAgentSkills({
      workspaceId: context.workspaceId,
      agentId: req.params.id,
      userId: context.userId,
      operation,
      skills: skills as string[],
    });

    await recordControlPlaneAudit({
      workspaceId: context.workspaceId,
      userId: context.userId,
      category: "agent_lifecycle",
      action: operation === "assign" ? "agent_skills_assigned" : "agent_skills_revoked",
      target: { type: "agent", id: agent.id },
      metadata: {
        runId: req.header("X-Paperclip-Run-Id"),
        teamId: agent.teamId,
        roleKey: agent.roleKey,
        skills,
      },
    });

    res.json(agent);
  } catch (error) {
    if (error instanceof Error && error.message === "agent_not_found") {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    if (error instanceof Error && error.message.startsWith("invalid_skills:")) {
      res.status(400).json({ error: `Unknown skills requested: ${error.message.slice("invalid_skills:".length)}` });
      return;
    }
    res.status(500).json({ error: "Unexpected control-plane skill mutation failure" });
  }
});

router.post("/tasks", requirePaperclipRunId, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { teamId, title, description, sourceRunId, sourceWorkflowStepId, assignedAgentId, metadata } =
    req.body as {
      teamId?: unknown;
      title?: unknown;
      description?: unknown;
      sourceRunId?: unknown;
      sourceWorkflowStepId?: unknown;
      assignedAgentId?: unknown;
      metadata?: unknown;
    };

  if (typeof teamId !== "string" || !teamId.trim()) {
    res.status(400).json({ error: "teamId is required" });
    return;
  }
  if (typeof title !== "string" || !title.trim()) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  try {
    const task = await controlPlaneStore.createTask({
      userId,
      teamId,
      title: title.trim(),
      description: typeof description === "string" ? description : undefined,
      sourceRunId: typeof sourceRunId === "string" ? sourceRunId : undefined,
      sourceWorkflowStepId: typeof sourceWorkflowStepId === "string" ? sourceWorkflowStepId : undefined,
      assignedAgentId: typeof assignedAgentId === "string" ? assignedAgentId : undefined,
      metadata:
        metadata && typeof metadata === "object" && !Array.isArray(metadata)
          ? (metadata as Record<string, unknown>)
          : undefined,
      actor: req.header("X-Paperclip-Run-Id") as string,
    });
    res.status(201).json(task);
  } catch (error) {
    if (error instanceof Error && error.message === "team_not_found") {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    if (error instanceof Error && error.message === "agent_not_found") {
      res.status(404).json({ error: "Assigned agent not found for team" });
      return;
    }
    res.status(500).json({ error: "Unexpected control-plane task creation failure" });
  }
});

router.get("/tasks", async (req: WorkspaceAwareRequest, res) => {
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }
  const teamId = typeof req.query.teamId === "string" ? req.query.teamId : undefined;
  // DASH-64.1: listTasks is now async (repository-backed).
  const tasks = await controlPlaneStore.listTasks(context.userId, teamId, context.workspaceId);
  res.json({ tasks, total: tasks.length });
});

router.get("/executions", (req: WorkspaceAwareRequest, res) => {
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }
  const teamId = typeof req.query.teamId === "string" ? req.query.teamId : undefined;
  const executions = controlPlaneStore.listExecutions(context.userId, teamId, context.workspaceId);
  res.json({ executions, total: executions.length });
});

router.post("/executions/:id/lifecycle", requirePaperclipRunId, async (req: WorkspaceAwareRequest, res) => {
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }

  const { action } = req.body as { action?: unknown };
  if (action !== "restart" && action !== "stop") {
    res.status(400).json({ error: "action must be restart or stop" });
    return;
  }

  try {
    const execution = await controlPlaneStore.updateExecutionLifecycle({
      workspaceId: context.workspaceId,
      executionId: req.params.id,
      userId: context.userId,
      action,
    });

    await recordControlPlaneAudit({
      workspaceId: context.workspaceId,
      userId: context.userId,
      category: "execution",
      action: action === "restart" ? "execution_restarted" : "execution_stopped",
      target: { type: "execution", id: execution.id },
      metadata: {
        runId: req.header("X-Paperclip-Run-Id"),
        teamId: execution.teamId,
        agentId: execution.agentId,
        status: execution.status,
        restartCount: execution.restartCount,
      },
    });

    res.json(execution);
  } catch (error) {
    if (error instanceof Error && error.message === "execution_not_found") {
      res.status(404).json({ error: "Execution not found" });
      return;
    }
    res.status(500).json({ error: "Unexpected control-plane execution lifecycle failure" });
  }
});

router.post("/tasks/:id/checkout", requirePaperclipRunId, async (req: WorkspaceAwareRequest, res) => {
  // DASH-64.1: now workspace-aware. Workspace context required for
  // the repository-backed task lookup. resolveWorkspaceContext on a
  // mutating verb always returns a defined workspaceId (either from
  // header or the test-mode fallback to userId), but TS can't narrow
  // through that branch — the explicit check below restates it.
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }
  if (!context.workspaceId) {
    res.status(400).json({ error: "Workspace context is required" });
    return;
  }

  try {
    const task = await controlPlaneStore.checkoutTask({
      taskId: req.params.id,
      userId: context.userId,
      actor: req.header("X-Paperclip-Run-Id") as string,
      workspaceId: context.workspaceId,
    });
    res.json(task);
  } catch (error) {
    if (error instanceof Error && error.message === "task_not_found") {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    if (error instanceof Error && error.message === "task_checked_out") {
      res.status(409).json({ error: "Task is already checked out by another run" });
      return;
    }
    res.status(500).json({ error: "Unexpected control-plane checkout failure" });
  }
});

router.patch("/tasks/:id/status", requirePaperclipRunId, async (req: WorkspaceAwareRequest, res) => {
  // DASH-64.1: now workspace-aware + async (was sync because the Map
  // lookup didn't await; repository read is async).
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }
  if (!context.workspaceId) {
    res.status(400).json({ error: "Workspace context is required" });
    return;
  }

  const { status } = req.body as { status?: unknown };
  if (status !== "todo" && status !== "in_progress" && status !== "done" && status !== "blocked") {
    res.status(400).json({ error: "status must be one of todo, in_progress, done, or blocked" });
    return;
  }

  try {
    const task = await controlPlaneStore.updateTaskStatus({
      taskId: req.params.id,
      userId: context.userId,
      actor: req.header("X-Paperclip-Run-Id") as string,
      status,
      workspaceId: context.workspaceId,
    });
    res.json(task);
  } catch (error) {
    if (error instanceof Error && error.message === "task_not_found") {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.status(500).json({ error: "Unexpected control-plane task update failure" });
  }
});

router.post("/heartbeats", requirePaperclipRunId, async (req: AuthenticatedRequest, res) => {
  const context = resolveWorkspaceContext(req as WorkspaceAwareRequest, res);
  if (!context) {
    return;
  }

  const { teamId, agentId, executionId, status, summary, costUsd, spendEntries, createdTaskIds, completedAt } = req.body as {
    teamId?: unknown;
    agentId?: unknown;
    executionId?: unknown;
    status?: unknown;
    summary?: unknown;
    costUsd?: unknown;
    spendEntries?: unknown;
    createdTaskIds?: unknown;
    completedAt?: unknown;
  };

  if (typeof teamId !== "string" || !teamId.trim()) {
    res.status(400).json({ error: "teamId is required" });
    return;
  }
  if (typeof agentId !== "string" || !agentId.trim()) {
    res.status(400).json({ error: "agentId is required" });
    return;
  }
  if (status !== "queued" && status !== "running" && status !== "completed" && status !== "blocked") {
    res.status(400).json({ error: "status must be one of queued, running, completed, or blocked" });
    return;
  }
  if (costUsd !== undefined && (typeof costUsd !== "number" || costUsd < 0)) {
    res.status(400).json({ error: "costUsd must be a non-negative number when provided" });
    return;
  }
  if (createdTaskIds !== undefined && !Array.isArray(createdTaskIds)) {
    res.status(400).json({ error: "createdTaskIds must be an array when provided" });
    return;
  }
  const parsedSpendEntries = parseSpendEntries(spendEntries);
  if (!parsedSpendEntries) {
    res.status(400).json({ error: "spendEntries must be an array of valid spend entry objects when provided" });
    return;
  }

  try {
    const heartbeat = await controlPlaneStore.recordHeartbeat({
      workspaceId: context.workspaceId,
      userId: context.userId,
      teamId,
      agentId,
      executionId: typeof executionId === "string" ? executionId : undefined,
      status,
      summary: typeof summary === "string" ? summary : undefined,
      costUsd: typeof costUsd === "number" ? costUsd : undefined,
      spendEntries: parsedSpendEntries,
      createdTaskIds: Array.isArray(createdTaskIds)
        ? createdTaskIds.filter((entry): entry is string => typeof entry === "string")
        : undefined,
      completedAt: typeof completedAt === "string" ? completedAt : undefined,
    });
    res.status(201).json(heartbeat);
  } catch (error) {
    if (error instanceof Error && error.message === "agent_not_found") {
      res.status(404).json({ error: "Agent not found for team" });
      return;
    }
    if (error instanceof Error && error.message === "execution_not_found") {
      res.status(404).json({ error: "Execution not found for team agent" });
      return;
    }
    if (error instanceof Error && error.message === "company_paused") {
      res.status(409).json({ error: "Company is paused; no new heartbeats may start" });
      return;
    }
    if (
      error instanceof Error &&
      (error.message === "team_budget_exceeded" ||
        error.message === "agent_budget_exceeded" ||
        error.message === "tool_budget_exceeded")
    ) {
      res.status(409).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Unexpected control-plane heartbeat failure" });
  }
});

router.post("/spend-events", requirePaperclipRunId, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { teamId, agentId, executionId, category, costUsd, model, provider, toolName, metadata } = req.body as {
    teamId?: unknown;
    agentId?: unknown;
    executionId?: unknown;
    category?: unknown;
    costUsd?: unknown;
    model?: unknown;
    provider?: unknown;
    toolName?: unknown;
    metadata?: unknown;
  };

  if (typeof teamId !== "string" || !teamId.trim()) {
    res.status(400).json({ error: "teamId is required" });
    return;
  }
  if (typeof agentId !== "string" || !agentId.trim()) {
    res.status(400).json({ error: "agentId is required" });
    return;
  }
  if (
    category !== "llm" &&
    category !== "tool" &&
    category !== "api" &&
    category !== "compute" &&
    category !== "ad_spend" &&
    category !== "third_party"
  ) {
    res.status(400).json({ error: "category must be a valid spend category" });
    return;
  }
  if (typeof costUsd !== "number" || costUsd < 0) {
    res.status(400).json({ error: "costUsd is required and must be a non-negative number" });
    return;
  }

  try {
    const entry = await controlPlaneStore.recordSpend({
      userId,
      teamId: teamId.trim(),
      agentId: agentId.trim(),
      executionId: typeof executionId === "string" ? executionId : undefined,
      category,
      costUsd,
      model: typeof model === "string" ? model : undefined,
      provider: typeof provider === "string" ? provider : undefined,
      toolName: typeof toolName === "string" ? toolName.trim() : undefined,
      metadata:
        metadata && typeof metadata === "object" && !Array.isArray(metadata)
          ? (metadata as Record<string, unknown>)
          : undefined,
    });
    res.status(201).json(entry);
  } catch (error) {
    if (error instanceof Error && error.message === "agent_not_found") {
      res.status(404).json({ error: "Agent not found for team" });
      return;
    }
    if (error instanceof Error && error.message === "execution_not_found") {
      res.status(404).json({ error: "Execution not found for team agent" });
      return;
    }
    if (
      error instanceof Error &&
      (error.message === "team_budget_exceeded" ||
        error.message === "agent_budget_exceeded" ||
        error.message === "tool_budget_exceeded")
    ) {
      res.status(409).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Unexpected control-plane spend event failure" });
  }
});

router.get("/heartbeats", async (req: WorkspaceAwareRequest, res) => {
  // DASH-64.2 + Codex review on #902: must resolve workspace context
  // before calling the async store. Without it, listHeartbeats falls
  // back to `workspaceId ?? userId`, which mismatches the real
  // workspace id in production and returns empty under
  // agent_heartbeats RLS.
  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }
  const teamId = typeof req.query.teamId === "string" ? req.query.teamId : undefined;
  const heartbeats = await controlPlaneStore.listHeartbeats(
    context.userId,
    teamId,
    context.workspaceId,
  );
  res.json({ heartbeats, total: heartbeats.length });
});

export default router;
