/**
 * Hiring plan routes (HEL-25).
 *
 * POST /api/hiring-plans/:hiringPlanId/confirm
 *   Atomically provision the agents the LLM drafted in this hiring plan:
 *
 *     1. Load the plan + parent mission, scoped to the active workspace.
 *     2. Validate the plan isn't already accepted.
 *     3. Inside a single transaction:
 *        a. Insert one agent row per `plan.provisioningPlan.agents` entry.
 *        b. Insert one `org_edges` row per `plan.orgChart.reportingLines`,
 *           translating roleKey → agent_id via the map built in (a).
 *        c. Mark the `hiring_plans` row as accepted (`accepted_at`,
 *           `accepted_by_user_id`).
 *        d. Mark the `missions` row as `active` so the Team page knows
 *           there's a live org graph to render.
 *        e. Emit `activity_events`: one `hiring_plan_accepted` plus one
 *           `agent_provisioned` per agent.
 *     4. Return the provisioned agents + edges so the dashboard can route
 *        immediately to the Team page.
 *
 * Idempotency: a second confirm on an already-accepted plan returns 409
 * with the original `accepted_at` so the client can show the existing
 * org rather than failing.
 *
 * Reference: `Projects/AutoFlow/v2/pages.jsx::AF2_Team` for the org chart
 * the provisioned agents feed into (HEL-26).
 */

import { Router } from "express";
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import type { Queue } from "bullmq";
import * as Sentry from "@sentry/node";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import {
  TEAM_ASSEMBLY_SCHEMA_VERSION,
  type TeamAssemblyResult,
} from "../goals/teamAssembly";
import {
  filterDraftByIncludedRoleKeys,
  resolveIncludedRoleKeys,
  validateIncludedRoleKeys,
  type HiringPlanDraft,
} from "./hiringPlanDraft";
import { resolveModelForTier } from "../engine/llmRouter";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { ensureUserProfileExists } from "../user/profileStore";
import { buildEntitlements, entitlementStore, getEntitlementLimits } from "../billing/entitlements";
import type { SubscriptionTier } from "../billing/subscriptionStore";
import { addRepeatableJob } from "../queue/scheduler";
import type { RunJobPayload } from "../queue/queues";
import { asyncHandler } from "../middleware/asyncHandler";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UPGRADE_PATH: Record<SubscriptionTier, SubscriptionTier | null> = {
  explore: "flow",
  flow: "automate",
  automate: "scale",
  scale: null,
};

function firstTierThatAllowsAgentCap(fromTier: SubscriptionTier): SubscriptionTier | null {
  let tier: SubscriptionTier | null = UPGRADE_PATH[fromTier] ?? null;
  while (tier) {
    if (getEntitlementLimits(tier).agentCap > 0) return tier;
    tier = UPGRADE_PATH[tier] ?? null;
  }
  return null;
}

export async function assertAgentCapForConfirm(
  pool: Pool,
  workspaceId: string,
  agentsToAdd: number,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const entitlements =
    (await entitlementStore.get(workspaceId)) ?? buildEntitlements(workspaceId, "explore");

  if (entitlements.agentCap <= 0) {
    return {
      status: 402,
      body: {
        error: "Plan limit reached: agentCap",
        code: "entitlement_exceeded",
        feature: "agentCap",
        limit: entitlements.agentCap,
        currentTier: entitlements.plan,
        upgradeTo: firstTierThatAllowsAgentCap(entitlements.plan),
      },
    };
  }

  const countResult = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM agents WHERE workspace_id = $1::uuid`,
    [workspaceId],
  );
  const current = Number(countResult.rows[0]?.n ?? 0);
  if (current + agentsToAdd > entitlements.agentCap) {
    return {
      status: 402,
      body: {
        error: "Plan limit reached: agentCap",
        code: "entitlement_exceeded",
        feature: "agentCap",
        limit: entitlements.agentCap,
        current,
        currentTier: entitlements.plan,
        upgradeTo: firstTierThatAllowsAgentCap(entitlements.plan),
      },
    };
  }

  return null;
}

export interface ProvisionedAgentRow {
  id: string;
  roleKey: string;
  name: string;
  modelTier: "lite" | "standard" | "power";
  model: string | null;
  budgetMonthlyUsd: number;
  reportingToAgentId: string | null;
}

export interface SeededRoutineRow {
  id: string;
  agentId: string;
  name: string;
  scheduleCron: string;
  llmTier: "lite" | "standard" | "power";
}

export interface ConfirmHiringPlanResponse {
  hiringPlanId: string;
  missionId: string;
  acceptedAt: string;
  agents: ProvisionedAgentRow[];
  orgEdges: Array<{ managerAgentId: string; agentId: string }>;
  // HEL-154: every confirmed agent gets a starter prompt-backed routine seeded
  // alongside the agent row. The dashboard surfaces "Default routines created"
  // CTAs linking to /agents/:id/standing-tasks.
  seededRoutines: SeededRoutineRow[];
}

interface PlanLookupRow {
  hiring_plan_id: string;
  mission_id: string;
  company_id: string;
  workspace_id: string;
  draft: TeamAssemblyResult;
  accepted_at: Date | null;
}

/**
 * Loads the hiring plan + mission + company chain, scoped to the active
 * workspace via RLS. Returns null if the plan doesn't exist or the
 * requesting workspace doesn't own it (RLS will return zero rows).
 */
async function loadHiringPlanScopedToWorkspace(
  pool: Pool,
  hiringPlanId: string,
  workspaceId: string,
  userId: string,
): Promise<PlanLookupRow | null> {
  const result = await withWorkspaceContext(
    pool,
    { workspaceId, userId },
    async (client) =>
      client.query<PlanLookupRow>(
        `SELECT hp.id AS hiring_plan_id,
                hp.mission_id,
                hp.draft,
                hp.accepted_at,
                m.company_id,
                c.workspace_id
           FROM hiring_plans hp
           JOIN missions m ON m.id = hp.mission_id
           JOIN companies c ON c.id = m.company_id
          WHERE hp.id = $1
          LIMIT 1`,
        [hiringPlanId],
      ),
  );
  return result.rows[0] ?? null;
}

/**
 * Get-or-create the default `agent_teams` row this workspace uses for
 * newly provisioned canonical agents. The legacy `agents.team_id` column
 * is still NOT NULL (predates HEL-13 canonical model), so we create one
 * team-per-workspace on first confirm and reuse it forever.
 *
 * Named after `provisioningPlan.teamName` from the plan draft on first
 * create; subsequent confirms reuse the same row regardless of plan name.
 *
 * Table name note: the canonical rename in migration 021 took
 * `control_plane_teams → agent_teams` (NOT just `teams`). An earlier
 * draft of this file referenced `teams`, which raised "relation does
 * not exist" inside the confirm transaction and surfaced as the generic
 * "Failed to confirm hiring plan" 500 the dashboard rendered as
 * "Failed to deploy mission" (DASH-1).
 */
export async function ensureWorkspaceTeam(
  client: PoolClient,
  workspaceId: string,
  userId: string,
  companyId: string,
  teamName: string,
): Promise<string> {
  // Reuse an existing team if one exists for this workspace.
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM agent_teams WHERE workspace_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [workspaceId],
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const teamId = randomUUID();
  await client.query(
    `INSERT INTO agent_teams (id, workspace_id, user_id, company_id, name, deployment_mode, status)
       VALUES ($1, $2, $3, $4, $5, 'continuous_agents', 'active')`,
    [teamId, workspaceId, userId, companyId, teamName],
  );
  return teamId;
}

interface AgentInsertParams {
  workspaceId: string;
  userId: string;
  teamId: string;
  companyId: string;
  missionId: string;
  hiringPlanId: string;
  roleKey: string;
  name: string;
  modelTier: "lite" | "standard" | "power";
  budgetMonthlyUsd: number;
  skills: string[];
  mandate: string;
}

export async function insertAgent(
  client: PoolClient,
  params: AgentInsertParams,
  defaultProvider: "openai" | "anthropic" | null,
): Promise<{ id: string; model: string | null }> {
  const id = randomUUID();
  // Resolve the model only if a workspace default LLM is configured.
  // Without a provider context we can't decode model name from tier — leave
  // null so the engine picks it up at run-time via the workspace's default
  // LLM config (same path the runner already uses for unassigned agents).
  const model = defaultProvider ? resolveModelForTier(defaultProvider, params.modelTier) : null;

  const metadata = JSON.stringify({
    missionId: params.missionId,
    hiringPlanId: params.hiringPlanId,
  });

  await client.query(
    `INSERT INTO agents (
       id, workspace_id, user_id, team_id, company_id,
       name, role_key, model, instructions, budget_monthly_usd,
       skills, schedule, status, metadata
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10,
       $11::jsonb, '{"type":"manual"}'::jsonb, 'active', $12::jsonb
     )`,
    [
      id,
      params.workspaceId,
      params.userId,
      params.teamId,
      params.companyId,
      params.name,
      params.roleKey,
      model,
      params.mandate,
      params.budgetMonthlyUsd,
      JSON.stringify(params.skills),
      metadata,
    ],
  );
  return { id, model };
}

/**
 * Wave 6: starter Job Description body derived from the StaffingRecommendation.
 *
 * Renders the agent's mandate / justification / kpis / tools / budget into
 * the same H2 section shape the dashboard's SectionEditor parses
 * (## Mission / ## How they work / ## Hard rules). The owner can edit or
 * fully rewrite via the wizard later; the point of seeding it on confirm
 * is to give the team a usable persona from day one without a tour
 * through each agent's settings page.
 *
 * No LLM call — the template is purely structural, derived from the
 * already-LLM-generated plan. Keeping confirm fast + free.
 */
export function buildStarterJobDescriptionBody(agent: {
  title: string;
  mandate: string;
  justification: string;
  kpis: string[];
  tools: string[];
  budgetMonthlyUsd: number | null;
}): string {
  const mandateLine = agent.mandate.trim();
  const justificationLine = agent.justification.trim();
  const kpiBullets = agent.kpis
    .map((kpi) => `- ${kpi.trim()}`)
    .join("\n");
  const toolsLine =
    agent.tools.length > 0
      ? `You'll typically use: ${agent.tools.join(", ")}.`
      : "";
  const budgetRule =
    typeof agent.budgetMonthlyUsd === "number" && agent.budgetMonthlyUsd > 0
      ? `- Stay within your monthly budget of $${agent.budgetMonthlyUsd.toFixed(0)}.`
      : "";

  const howTheyWork = [
    justificationLine,
    "",
    "You're responsible for:",
    kpiBullets,
    toolsLine,
  ]
    .filter((line) => line.trim().length > 0)
    .join("\n");

  const hardRules = [
    budgetRule,
    "- Escalate to your manager any decision that affects other teams or sensitive customers.",
    "- Never share credentials, customer data, or financial info outside the workspace.",
  ]
    .filter((line) => line.trim().length > 0)
    .join("\n");

  return [
    "## Mission",
    mandateLine,
    "",
    "## How they work",
    howTheyWork,
    "",
    "## Hard rules",
    hardRules,
  ].join("\n");
}

export async function insertStarterJobDescription(
  client: PoolClient,
  params: {
    workspaceId: string;
    userId: string;
    agentId: string;
    agentTitle: string;
    body: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO workspace_instructions
        (id, workspace_id, agent_id, kind, title, body, version, author_user_id)
       VALUES ($1, $2, $3, 'instruction', $4, $5, 1, $6)`,
    [
      randomUUID(),
      params.workspaceId,
      params.agentId,
      `${params.agentTitle} — Job description`,
      params.body,
      params.userId,
    ],
  );
}

/**
 * HEL-154: starter prompt for the seeded routine.
 *
 * We don't want to bury the agent on day one with a synthetic DAG — instead
 * we seed a single weekday-morning prompt-backed routine whose body restates
 * the agent's mandate + asks for a short status report. Owner can refine the
 * prompt or change the cron from `/agents/:id/standing-tasks`, or replace it
 * with a DAG routine from Studio if the work outgrows a single LLM turn.
 */
export function buildStarterRoutinePrompt(agent: {
  title: string;
  mandate: string;
}): string {
  const mandate = agent.mandate.trim();
  return [
    `You are ${agent.title}.`,
    "",
    "**Mandate**",
    mandate,
    "",
    "**This routine**",
    "Review what's happened in your area since the last check-in (open assignments, recent activity, anything blocked).",
    "Produce a short status report:",
    "  1. What moved",
    "  2. What's stuck (and what you need to unblock it)",
    "  3. Top 1–2 actions you'll take next",
    "",
    "Keep it under 200 words. If you need a human, file an assignment instead of stalling.",
  ].join("\n");
}

/**
 * HEL-154: starter cron for the seeded routine.
 *
 * Weekday-morning UTC. Owner can change it on the standing-tasks page. We pick
 * `0 9 * * 1-5` (Mon–Fri 09:00 UTC ≈ 5am ET / 2am PT) — early enough that a
 * morning-check-in style routine has fresh output before the workday starts
 * for US-Eastern users.
 */
const STARTER_ROUTINE_CRON = "0 9 * * 1-5";

export async function seedDefaultRoutineForAgent(
  client: PoolClient,
  params: {
    workspaceId: string;
    agentId: string;
    agentName: string;
    mandate: string;
    modelTier: "lite" | "standard" | "power";
  },
): Promise<SeededRoutineRow> {
  const prompt = buildStarterRoutinePrompt({
    title: params.agentName,
    mandate: params.mandate,
  });
  const name = `${params.agentName} morning check-in`;
  const insert = await client.query<{
    id: string;
    name: string;
    schedule_cron: string;
    llm_tier: "lite" | "standard" | "power";
  }>(
    `INSERT INTO routines
        (workspace_id, agent_id, name, schedule_cron, trigger_kind,
         workflow_id, prompt, system_prompt, llm_tier, enabled)
     VALUES ($1::uuid, $2::uuid, $3, $4, 'scheduled',
             NULL, $5, NULL, $6, true)
     RETURNING id::text, name, schedule_cron, llm_tier`,
    [
      params.workspaceId,
      params.agentId,
      name,
      STARTER_ROUTINE_CRON,
      prompt,
      params.modelTier,
    ],
  );
  const row = insert.rows[0]!;
  return {
    id: row.id,
    agentId: params.agentId,
    name: row.name,
    scheduleCron: row.schedule_cron,
    llmTier: row.llm_tier,
  };
}

export async function emitActivityEvent(
  client: PoolClient,
  workspaceId: string,
  kind: string,
  actorUserId: string,
  subject: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO activity_events (workspace_id, kind, actor, subject, payload)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)`,
    [
      workspaceId,
      kind,
      JSON.stringify({ type: "user", id: actorUserId }),
      JSON.stringify(subject),
      JSON.stringify(payload),
    ],
  );
}

/**
 * DASH-21: pg driver attaches structured fields (code, constraint
 * name, table, schema, detail) to its Error instances. Pull them out
 * so the route can surface "exactly what failed" without the caller
 * needing to grep the message string. Returns an empty object for
 * non-pg errors.
 */
function extractPgErrorFields(err: unknown): {
  code?: string;
  constraint?: string;
  table?: string;
  schema?: string;
  column?: string;
  detail?: string;
  routine?: string;
} {
  if (!err || typeof err !== "object") return {};
  const e = err as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const key of [
    "code",
    "constraint",
    "table",
    "schema",
    "column",
    "detail",
    "routine",
  ]) {
    const v = e[key];
    if (typeof v === "string" && v.length > 0) fields[key] = v;
  }
  return fields;
}

function composeDetailMessage(
  baseMessage: string,
  pg: ReturnType<typeof extractPgErrorFields>,
): string {
  if (Object.keys(pg).length === 0) return baseMessage;
  const parts: string[] = [baseMessage];
  if (pg.code) parts.push(`pg_code=${pg.code}`);
  if (pg.constraint) parts.push(`constraint=${pg.constraint}`);
  if (pg.table) parts.push(`table=${pg.table}`);
  if (pg.column) parts.push(`column=${pg.column}`);
  if (pg.detail) parts.push(`pg_detail=${pg.detail}`);
  return parts.join(" · ");
}

export function createHiringPlanRoutes(
  pool: Pool,
  runQueue: Queue<RunJobPayload> | null = null,
) {
  const router = Router();

  // HEL-105: side-by-side review needs to read the plan + mission context
  // in one call. Returns the draft TeamAssemblyResult under `plan`, plus the
  // mission statement / acceptance state so the review page can show
  // "already confirmed" without a second roundtrip.
  router.get("/:hiringPlanId", asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const hiringPlanId = req.params.hiringPlanId;
    if (!hiringPlanId || !UUID_RE.test(hiringPlanId)) {
      res.status(400).json({ error: "Invalid hiring plan ID format" });
      return;
    }

    interface PlanDetailRow {
      id: string;
      mission_id: string;
      mission_statement: string;
      draft: HiringPlanDraft;
      accepted_at: Date | string | null;
      accepted_by_user_id: string | null;
      created_at: Date | string;
    }

    try {
      const result = await withWorkspaceContext(
        pool,
        { workspaceId, userId },
        async (client) =>
          client.query<PlanDetailRow>(
            `SELECT hp.id, hp.mission_id, m.statement AS mission_statement,
                    hp.draft, hp.accepted_at, hp.accepted_by_user_id, hp.created_at
               FROM hiring_plans hp
               JOIN missions m ON m.id = hp.mission_id
               JOIN companies c ON c.id = m.company_id
              WHERE hp.id = $1
              LIMIT 1`,
            [hiringPlanId],
          ),
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "Hiring plan not found" });
        return;
      }

      const row = result.rows[0];
      // UX-4: pre-compute the starter Job Description bodies that the
      // confirm flow (Wave 6) would seed per agent. Surfacing them
      // here lets the review page show owners exactly what each
      // agent's persona will look like before they click Confirm —
      // no surprises, no "where did this come from?" moment.
      const draft = row.draft;
      const starterJobDescriptions =
        draft?.provisioningPlan?.agents?.map((agent) => ({
          agentRoleKey: agent.roleKey,
          agentTitle: agent.title,
          title: `${agent.title} — Job description`,
          body: buildStarterJobDescriptionBody({
            title: agent.title,
            mandate: agent.mandate,
            justification: agent.justification,
            kpis: agent.kpis,
            tools: agent.tools,
            budgetMonthlyUsd: agent.budgetMonthlyUsd,
          }),
        })) ?? [];

      res.json({
        id: row.id,
        missionId: row.mission_id,
        missionStatement: row.mission_statement,
        plan: row.draft,
        starterJobDescriptions,
        acceptedAt:
          row.accepted_at instanceof Date
            ? row.accepted_at.toISOString()
            : row.accepted_at,
        acceptedByUserId: row.accepted_by_user_id,
        createdAt:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : String(row.created_at),
      });
    } catch (err) {
      console.error(`[hiring-plans] get failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to load hiring plan" });
    }
  }));

  router.post("/:hiringPlanId/confirm", asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const hiringPlanId = req.params.hiringPlanId;
    if (!hiringPlanId || !UUID_RE.test(hiringPlanId)) {
      res.status(400).json({ error: "Invalid hiring plan ID format" });
      return;
    }

    // DASH-1 redux: `hiring_plans.accepted_by_user_id` has a FK on
    // `user_profiles(user_id)`. OAuth-only users who have never opened
    // Profile Settings don't yet have a user_profiles row, so the
    // UPDATE inside the transaction below would fail with a FK
    // violation that the catch block surfaced as the generic
    // "Failed to confirm hiring plan" 500. Auto-provision the empty
    // profile row up front (same pattern POST /api/missions uses) so
    // the FK is satisfied before we open the transaction.
    try {
      await ensureUserProfileExists(userId);
    } catch (err) {
      console.error(
        `[hiring-plans] ensureUserProfileExists failed: ${(err as Error).message}`,
      );
      Sentry.captureException(err, {
        tags: {
          route: "POST /api/hiring-plans/:hiringPlanId/confirm",
          phase: "ensure_user_profile",
        },
        contexts: { hiring_plan: { workspaceId, userId, hiringPlanId } },
      });
      res.status(500).json({ error: "Failed to provision user profile" });
      return;
    }

    let lookup: PlanLookupRow | null;
    try {
      lookup = await loadHiringPlanScopedToWorkspace(pool, hiringPlanId, workspaceId, userId);
    } catch (err) {
      console.error(`[hiring-plans] lookup failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to load hiring plan" });
      return;
    }
    if (!lookup) {
      res.status(404).json({ error: "Hiring plan not found" });
      return;
    }

    if (lookup.accepted_at) {
      res.status(409).json({
        error: "Hiring plan already accepted",
        acceptedAt:
          lookup.accepted_at instanceof Date
            ? lookup.accepted_at.toISOString()
            : String(lookup.accepted_at),
      });
      return;
    }

    // Schema sanity check: the draft must be a TeamAssemblyResult matching
    // the schema version this code knows how to provision. A mismatch is a
    // 422 because the user can re-generate the plan rather than retry-retry.
    const draft = lookup.draft as HiringPlanDraft;
    if (!draft || draft.schemaVersion !== TEAM_ASSEMBLY_SCHEMA_VERSION) {
      res.status(422).json({
        error: `Hiring plan schema version mismatch (got ${
          draft?.schemaVersion ?? "missing"
        }, expected ${TEAM_ASSEMBLY_SCHEMA_VERSION}). Re-generate the plan.`,
      });
      return;
    }

    const body = req.body as { includedRoleKeys?: unknown };
    const bodyIncluded = Array.isArray(body?.includedRoleKeys)
      ? body.includedRoleKeys.filter((key): key is string => typeof key === "string")
      : undefined;
    const includedRoleKeys = resolveIncludedRoleKeys(draft, bodyIncluded);
    const selectionError = validateIncludedRoleKeys(draft, includedRoleKeys);
    if (selectionError) {
      res.status(400).json({ error: selectionError });
      return;
    }

    const provisionDraft = filterDraftByIncludedRoleKeys(draft, includedRoleKeys);

    const agentsToAdd = provisionDraft.provisioningPlan.agents.length;
    const capViolation = await assertAgentCapForConfirm(pool, workspaceId, agentsToAdd);
    if (capViolation) {
      res.status(capViolation.status).json(capViolation.body);
      return;
    }

    // Resolve the workspace's default LLM provider so we can pick a model
    // name per agent's tier. If no provider is configured, agents land with
    // model=null and the engine will use the workspace default at run-time.
    let defaultProvider: "openai" | "anthropic" | null = null;
    try {
      const resolved = await llmConfigStore.getDecryptedDefault(userId);
      if (resolved && (resolved.config.provider === "openai" || resolved.config.provider === "anthropic")) {
        defaultProvider = resolved.config.provider;
      }
    } catch {
      // Non-fatal — fall through with null. Agents are still provisionable.
    }

    let response: ConfirmHiringPlanResponse;
    try {
      response = await withWorkspaceContext(
        pool,
        { workspaceId, userId },
        async (client) => {
          // DASH-21: withWorkspaceContext already wrapped this callback
          // in BEGIN + SET LOCAL. The inner BEGIN that used to live
          // here was a no-op WARNING (postgres rejects nested
          // transactions), but the matching inner COMMIT closed the
          // outer transaction prematurely — at which point SET LOCAL
          // cleared and any tail query would have run without RLS
          // workspace context. Drop both: throw on error so the
          // wrapper rolls back, return on success so it commits.
          try {
            // Re-check inside the transaction to avoid the two-confirm race.
            const recheck = await client.query<{ accepted_at: Date | null }>(
              `SELECT accepted_at FROM hiring_plans WHERE id = $1 FOR UPDATE`,
              [hiringPlanId],
            );
            if (recheck.rows[0]?.accepted_at) {
              throw new Error(
                `__already_accepted:${
                  recheck.rows[0].accepted_at instanceof Date
                    ? recheck.rows[0].accepted_at.toISOString()
                    : String(recheck.rows[0].accepted_at)
                }`,
              );
            }

            const teamId = await ensureWorkspaceTeam(
              client,
              workspaceId,
              userId,
              lookup!.company_id,
              provisionDraft.provisioningPlan.teamName,
            );

            // 1. Insert agents, build roleKey → agentId map.
            const agentRows: ProvisionedAgentRow[] = [];
            const roleKeyToAgentId = new Map<string, string>();
            // HEL-154: rows we seeded so the response can deep-link to them
            // and the post-commit scheduler register knows what to enqueue.
            const seededRoutines: SeededRoutineRow[] = [];
            for (const agent of provisionDraft.provisioningPlan.agents) {
              const { id, model } = await insertAgent(
                client,
                {
                  workspaceId,
                  userId,
                  teamId,
                  companyId: lookup!.company_id,
                  missionId: lookup!.mission_id,
                  hiringPlanId,
                  roleKey: agent.roleKey,
                  name: agent.title,
                  modelTier: agent.modelTier,
                  budgetMonthlyUsd: agent.budgetMonthlyUsd ?? 0,
                  skills: agent.skills,
                  mandate: agent.mandate,
                },
                defaultProvider,
              );
              roleKeyToAgentId.set(agent.roleKey, id);
              agentRows.push({
                id,
                roleKey: agent.roleKey,
                name: agent.title,
                modelTier: agent.modelTier,
                model,
                budgetMonthlyUsd: agent.budgetMonthlyUsd ?? 0,
                reportingToAgentId: null,
              });

              // Wave 6: seed a starter Job Description (Wave 3 substrate)
              // so the new agent has a usable persona on day one. Owner
              // can edit / re-draft via the wizard on the agent's
              // /agents/:id/job page.
              //
              // DASH-1: the JD seed is a nice-to-have, NOT load-bearing —
              // an agent with no starter JD still runs fine, the wizard
              // just opens to an empty editor. So we use a SAVEPOINT and
              // swallow failures rather than letting them roll back the
              // whole agent provisioning. Sentry still gets the exception
              // so we notice when seeding regresses.
              const starterBody = buildStarterJobDescriptionBody({
                title: agent.title,
                mandate: agent.mandate,
                justification: agent.justification,
                kpis: agent.kpis,
                tools: agent.tools,
                budgetMonthlyUsd: agent.budgetMonthlyUsd,
              });
              await client.query("SAVEPOINT starter_jd");
              try {
                await insertStarterJobDescription(client, {
                  workspaceId,
                  userId,
                  agentId: id,
                  agentTitle: agent.title,
                  body: starterBody,
                });
                await client.query("RELEASE SAVEPOINT starter_jd");
              } catch (jdErr) {
                await client.query("ROLLBACK TO SAVEPOINT starter_jd");
                console.warn(
                  `[hiring-plans] starter JD seed failed for agent ${id} (continuing): ${
                    (jdErr as Error).message
                  }`,
                );
                Sentry.captureException(jdErr, {
                  tags: {
                    route: "POST /api/hiring-plans/:hiringPlanId/confirm",
                    phase: "starter_job_description",
                  },
                  contexts: {
                    hiring_plan: {
                      workspaceId,
                      hiringPlanId,
                      agentId: id,
                      roleKey: agent.roleKey,
                    },
                  },
                });
              }

              // HEL-154: seed a starter prompt-backed routine alongside the
              // agent — weekday morning check-in built on the HEL-174
              // executeAgentPrompt() primitive. Like the JD seed this is
              // nice-to-have; failure shouldn't roll back agent provisioning,
              // so we wrap it in a SAVEPOINT and continue with a Sentry alert.
              await client.query("SAVEPOINT starter_routine");
              try {
                const seeded = await seedDefaultRoutineForAgent(client, {
                  workspaceId,
                  agentId: id,
                  agentName: agent.title,
                  mandate: agent.mandate,
                  modelTier: agent.modelTier,
                });
                seededRoutines.push(seeded);
                await client.query("RELEASE SAVEPOINT starter_routine");
              } catch (routineErr) {
                await client.query("ROLLBACK TO SAVEPOINT starter_routine");
                console.warn(
                  `[hiring-plans] starter routine seed failed for agent ${id} (continuing): ${
                    (routineErr as Error).message
                  }`,
                );
                Sentry.captureException(routineErr, {
                  tags: {
                    route: "POST /api/hiring-plans/:hiringPlanId/confirm",
                    phase: "starter_routine",
                  },
                  contexts: {
                    hiring_plan: {
                      workspaceId,
                      hiringPlanId,
                      agentId: id,
                      roleKey: agent.roleKey,
                    },
                  },
                });
              }
            }

            // 2. Insert org_edges from reportingLines.
            const orgEdges: Array<{ managerAgentId: string; agentId: string }> = [];
            for (const edge of provisionDraft.orgChart.reportingLines) {
              const managerAgentId = roleKeyToAgentId.get(edge.managerRoleKey);
              const reportAgentId = roleKeyToAgentId.get(edge.reportRoleKey);
              if (!managerAgentId || !reportAgentId) {
                // The plan references a role the provisioning step didn't
                // emit. Skip rather than fail — the missing edge is a
                // recoverable issue (user can fix the plan + reprovision).
                continue;
              }
              if (managerAgentId === reportAgentId) {
                // Self-loop guard mirrored from the db CHECK constraint.
                continue;
              }
              await client.query(
                `INSERT INTO org_edges (workspace_id, manager_agent_id, agent_id)
                   VALUES ($1, $2, $3)
                   ON CONFLICT (manager_agent_id, agent_id) DO NOTHING`,
                [workspaceId, managerAgentId, reportAgentId],
              );
              orgEdges.push({ managerAgentId, agentId: reportAgentId });

              // Also update the legacy agents.reporting_to_agent_id for the
              // simple parent-pointer query path the existing dashboard uses.
              await client.query(
                `UPDATE agents SET reporting_to_agent_id = $1 WHERE id = $2`,
                [managerAgentId, reportAgentId],
              );
              const row = agentRows.find((r) => r.id === reportAgentId);
              if (row) row.reportingToAgentId = managerAgentId;
            }

            // 3. Mark the hiring plan accepted.
            const accept = await client.query<{ accepted_at: Date }>(
              `UPDATE hiring_plans
                  SET accepted_at = now(),
                      accepted_by_user_id = $2
                WHERE id = $1
                RETURNING accepted_at`,
              [hiringPlanId, userId],
            );
            const acceptedAt =
              accept.rows[0]?.accepted_at instanceof Date
                ? accept.rows[0].accepted_at.toISOString()
                : String(accept.rows[0]?.accepted_at);

            // 4. Mark the parent mission active.
            await client.query(
              `UPDATE missions SET status = 'active' WHERE id = $1 AND status <> 'active'`,
              [lookup!.mission_id],
            );

            // 5. Emit activity events.
            await emitActivityEvent(
              client,
              workspaceId,
              "hiring_plan_accepted",
              userId,
              { type: "hiring_plan", id: hiringPlanId, missionId: lookup!.mission_id },
              { agentCount: agentRows.length, edgeCount: orgEdges.length },
            );
            for (const agent of agentRows) {
              await emitActivityEvent(
                client,
                workspaceId,
                "agent_provisioned",
                userId,
                { type: "agent", id: agent.id, label: agent.name },
                {
                  roleKey: agent.roleKey,
                  modelTier: agent.modelTier,
                  budgetMonthlyUsd: agent.budgetMonthlyUsd,
                  hiringPlanId,
                },
              );
            }
            // HEL-154: per-routine activity event so the Activity feed shows
            // "Default routine created for <agent>" alongside the provisioning.
            for (const seeded of seededRoutines) {
              await emitActivityEvent(
                client,
                workspaceId,
                "routine_created",
                userId,
                { type: "routine", id: seeded.id, label: seeded.name },
                {
                  agentId: seeded.agentId,
                  scheduleCron: seeded.scheduleCron,
                  llmTier: seeded.llmTier,
                  source: "hiring_plan_confirm",
                  hiringPlanId,
                },
              );
            }

            // DASH-21: no manual COMMIT — withWorkspaceContext owns
            // the transaction lifecycle. Returning the response
            // triggers the wrapper's commit.
            return {
              hiringPlanId,
              missionId: lookup!.mission_id,
              acceptedAt,
              agents: agentRows,
              orgEdges,
              seededRoutines,
            } satisfies ConfirmHiringPlanResponse;
          } catch (err) {
            // DASH-21: no manual ROLLBACK — withWorkspaceContext
            // catches the throw and rolls back. Re-throwing
            // preserves the original cause for the outer catch.
            throw err;
          }
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("__already_accepted:")) {
        const acceptedAt = message.split(":")[1];
        res.status(409).json({ error: "Hiring plan already accepted", acceptedAt });
        return;
      }
      // DASH-21: extract pg-specific fields when present (code,
      // constraint, table, detail). These pinpoint exactly which
      // FK/RLS/check failed without needing schema knowledge on
      // the dashboard side.
      const pgFields = extractPgErrorFields(err);
      console.error(
        `[hiring-plans] confirm failed: ${message}`,
        pgFields,
        err instanceof Error ? err.stack : undefined,
      );
      Sentry.captureException(err, {
        tags: {
          route: "POST /api/hiring-plans/:hiringPlanId/confirm",
          phase: "transaction",
          ...(pgFields.code ? { pg_code: pgFields.code } : {}),
          ...(pgFields.constraint ? { pg_constraint: pgFields.constraint } : {}),
        },
        contexts: {
          hiring_plan: {
            workspaceId,
            userId,
            hiringPlanId,
            missionId: lookup?.mission_id,
            companyId: lookup?.company_id,
          },
          ...(Object.keys(pgFields).length > 0 ? { postgres: pgFields } : {}),
        },
      });
      // Surface the underlying cause to the caller. AutoFlow is
      // pre-launch + internal; "schema hint leakage" is a much
      // smaller risk than an undiagnosable confirm bug for the
      // founder + early customers. Revisit when external multi-
      // tenant customers actually exist.
      res.status(500).json({
        error: "Failed to confirm hiring plan",
        detail: composeDetailMessage(message, pgFields),
        ...(Object.keys(pgFields).length > 0 ? { postgres: pgFields } : {}),
      });
      return;
    }

    // HEL-154: register BullMQ schedulers for every seeded routine. Outside
    // the transaction by design — the routines + agents are already
    // committed, so a scheduler-register failure logs + reports but does NOT
    // unwind provisioning. Without a runQueue (no Redis / test mode) the
    // routines exist in the DB but won't fire until the next worker boot
    // syncs from the routines table.
    if (runQueue && response.seededRoutines.length > 0) {
      for (const seeded of response.seededRoutines) {
        try {
          await addRepeatableJob(
            runQueue,
            seeded.id,
            seeded.scheduleCron,
            workspaceId,
          );
        } catch (schedErr) {
          console.warn(
            `[hiring-plans] failed to register scheduler for routine ${seeded.id}: ${
              (schedErr as Error).message
            }`,
          );
          Sentry.captureException(schedErr, {
            tags: {
              route: "POST /api/hiring-plans/:hiringPlanId/confirm",
              phase: "register_routine_scheduler",
            },
            contexts: {
              routine: {
                workspaceId,
                routineId: seeded.id,
                scheduleCron: seeded.scheduleCron,
              },
            },
          });
        }
      }
    }

    res.status(200).json(response);
  }));

  router.patch("/:hiringPlanId/draft", asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const hiringPlanId = req.params.hiringPlanId;
    if (!hiringPlanId || !UUID_RE.test(hiringPlanId)) {
      res.status(400).json({ error: "Invalid hiring plan ID format" });
      return;
    }

    // Two optional fields on this PATCH:
    //   - includedRoleKeys: which agents the reviewer wants to provision
    //   - tierOverrides:    per-agent tier reassignment (Phase 2b, HEL-todo).
    //                        Reviewer picks "use Power instead of Standard"
    //                        for a specific agent, on top of the LLM-suggested
    //                        tier. We mutate the draft's
    //                        provisioningPlan.agents[].modelTier in place so
    //                        the existing confirm path picks them up without
    //                        any further wiring — same {provider, model}
    //                        resolution applies via the workspace's tier
    //                        routing matrix.
    const body = req.body as {
      includedRoleKeys?: unknown;
      tierOverrides?: unknown;
    };

    const wantsIncluded = body.includedRoleKeys !== undefined;
    const wantsOverrides = body.tierOverrides !== undefined;
    if (!wantsIncluded && !wantsOverrides) {
      res.status(400).json({
        error: "Provide at least one of includedRoleKeys or tierOverrides.",
      });
      return;
    }

    let includedRoleKeys: string[] | null = null;
    if (wantsIncluded) {
      if (
        !Array.isArray(body.includedRoleKeys) ||
        (body.includedRoleKeys as unknown[]).some((key) => typeof key !== "string")
      ) {
        res
          .status(400)
          .json({ error: "includedRoleKeys must be an array of strings" });
        return;
      }
      includedRoleKeys = body.includedRoleKeys as string[];
    }

    let tierOverrides: Record<string, "lite" | "standard" | "power"> | null = null;
    if (wantsOverrides) {
      if (
        !body.tierOverrides ||
        typeof body.tierOverrides !== "object" ||
        Array.isArray(body.tierOverrides)
      ) {
        res
          .status(400)
          .json({ error: "tierOverrides must be an object keyed by roleKey" });
        return;
      }
      const validTiers = new Set(["lite", "standard", "power"]);
      const out: Record<string, "lite" | "standard" | "power"> = {};
      for (const [roleKey, tier] of Object.entries(
        body.tierOverrides as Record<string, unknown>,
      )) {
        if (typeof roleKey !== "string" || roleKey.trim() === "") {
          res.status(400).json({ error: "tierOverrides keys must be non-empty role keys" });
          return;
        }
        if (typeof tier !== "string" || !validTiers.has(tier)) {
          res.status(400).json({
            error: `tierOverrides.${roleKey} must be one of "lite" | "standard" | "power"`,
          });
          return;
        }
        out[roleKey] = tier as "lite" | "standard" | "power";
      }
      tierOverrides = out;
    }

    try {
      const lookup = await loadHiringPlanScopedToWorkspace(pool, hiringPlanId, workspaceId, userId);
      if (!lookup) {
        res.status(404).json({ error: "Hiring plan not found" });
        return;
      }
      if (lookup.accepted_at) {
        res.status(409).json({ error: "Hiring plan already accepted" });
        return;
      }

      const draft = lookup.draft as HiringPlanDraft;

      // Validate selection if provided. (We still validate even when only
      // overrides are sent because resolveIncludedRoleKeys may default the
      // selection to "all," but the existing helper only validates an
      // explicit array.)
      if (includedRoleKeys !== null) {
        const selectionError = validateIncludedRoleKeys(draft, includedRoleKeys);
        if (selectionError) {
          res.status(400).json({ error: selectionError });
          return;
        }
      }

      // Validate every tierOverride key matches an agent in the draft.
      if (tierOverrides !== null) {
        const knownRoles = new Set(
          draft.provisioningPlan.agents.map((a) => a.roleKey),
        );
        const unknown = Object.keys(tierOverrides).filter(
          (k) => !knownRoles.has(k),
        );
        if (unknown.length > 0) {
          res.status(400).json({
            error: `tierOverrides references unknown role keys: ${unknown.join(", ")}`,
          });
          return;
        }
      }

      // Build the next draft. Selection changes nest under draft.selection.
      // Tier overrides are applied directly onto provisioningPlan.agents (+
      // orgChart.executives / operators where the same role exists), so the
      // existing confirm path picks them up without conditional logic.
      const nextAgents = tierOverrides
        ? draft.provisioningPlan.agents.map((a) =>
            tierOverrides![a.roleKey]
              ? { ...a, modelTier: tierOverrides![a.roleKey] }
              : a,
          )
        : draft.provisioningPlan.agents;

      const nextExecutives = tierOverrides
        ? draft.orgChart.executives.map((a) =>
            tierOverrides![a.roleKey]
              ? { ...a, modelTier: tierOverrides![a.roleKey] }
              : a,
          )
        : draft.orgChart.executives;

      const nextOperators = tierOverrides
        ? draft.orgChart.operators.map((a) =>
            tierOverrides![a.roleKey]
              ? { ...a, modelTier: tierOverrides![a.roleKey] }
              : a,
          )
        : draft.orgChart.operators;

      const updated: HiringPlanDraft = {
        ...draft,
        orgChart: {
          ...draft.orgChart,
          executives: nextExecutives,
          operators: nextOperators,
        },
        provisioningPlan: {
          ...draft.provisioningPlan,
          agents: nextAgents,
        },
        selection:
          includedRoleKeys !== null
            ? { includedRoleKeys }
            : draft.selection,
      };

      await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
        await client.query(`UPDATE hiring_plans SET draft = $2::jsonb WHERE id = $1`, [
          hiringPlanId,
          JSON.stringify(updated),
        ]);
      });

      res.json({ plan: updated });
    } catch (err) {
      console.error(`[hiring-plans] patch draft failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to update hiring plan draft" });
    }
  }));

  return router;
}
