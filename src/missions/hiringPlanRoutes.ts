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
import * as Sentry from "@sentry/node";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import {
  TEAM_ASSEMBLY_SCHEMA_VERSION,
  type TeamAssemblyResult,
} from "../goals/teamAssembly";
import { resolveModelForTier } from "../engine/llmRouter";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { ensureUserProfileExists } from "../user/profileStore";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ProvisionedAgentRow {
  id: string;
  roleKey: string;
  name: string;
  modelTier: "lite" | "standard" | "power";
  model: string | null;
  budgetMonthlyUsd: number;
  reportingToAgentId: string | null;
}

export interface ConfirmHiringPlanResponse {
  hiringPlanId: string;
  missionId: string;
  acceptedAt: string;
  agents: ProvisionedAgentRow[];
  orgEdges: Array<{ managerAgentId: string; agentId: string }>;
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
async function ensureWorkspaceTeam(
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
  roleKey: string;
  name: string;
  modelTier: "lite" | "standard" | "power";
  budgetMonthlyUsd: number;
  skills: string[];
  mandate: string;
}

async function insertAgent(
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

  await client.query(
    `INSERT INTO agents (
       id, workspace_id, user_id, team_id, company_id,
       name, role_key, model, instructions, budget_monthly_usd,
       skills, schedule, status
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10,
       $11::jsonb, '{"type":"manual"}'::jsonb, 'active'
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

async function insertStarterJobDescription(
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

async function emitActivityEvent(
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

export function createHiringPlanRoutes(pool: Pool) {
  const router = Router();

  // HEL-105: side-by-side review needs to read the plan + mission context
  // in one call. Returns the draft TeamAssemblyResult under `plan`, plus the
  // mission statement / acceptance state so the review page can show
  // "already confirmed" without a second roundtrip.
  router.get("/:hiringPlanId", async (req: AuthenticatedRequest, res) => {
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
      draft: TeamAssemblyResult;
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
  });

  router.post("/:hiringPlanId/confirm", async (req: AuthenticatedRequest, res) => {
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
    const draft = lookup.draft;
    if (!draft || draft.schemaVersion !== TEAM_ASSEMBLY_SCHEMA_VERSION) {
      res.status(422).json({
        error: `Hiring plan schema version mismatch (got ${
          draft?.schemaVersion ?? "missing"
        }, expected ${TEAM_ASSEMBLY_SCHEMA_VERSION}). Re-generate the plan.`,
      });
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
          await client.query("BEGIN");

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
              draft.provisioningPlan.teamName,
            );

            // 1. Insert agents, build roleKey → agentId map.
            const agentRows: ProvisionedAgentRow[] = [];
            const roleKeyToAgentId = new Map<string, string>();
            for (const agent of draft.provisioningPlan.agents) {
              const { id, model } = await insertAgent(
                client,
                {
                  workspaceId,
                  userId,
                  teamId,
                  companyId: lookup!.company_id,
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
            }

            // 2. Insert org_edges from reportingLines.
            const orgEdges: Array<{ managerAgentId: string; agentId: string }> = [];
            for (const edge of draft.orgChart.reportingLines) {
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

            await client.query("COMMIT");

            return {
              hiringPlanId,
              missionId: lookup!.mission_id,
              acceptedAt,
              agents: agentRows,
              orgEdges,
            } satisfies ConfirmHiringPlanResponse;
          } catch (err) {
            try {
              await client.query("ROLLBACK");
            } catch {
              // Swallow ROLLBACK errors so the original cause surfaces.
            }
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
      console.error(`[hiring-plans] confirm failed: ${message}`);
      // DASH-1: capture the underlying exception so we can diagnose
      // regressions like the "relation teams does not exist" bug
      // without having to instrument the route after the fact.
      Sentry.captureException(err, {
        tags: {
          route: "POST /api/hiring-plans/:hiringPlanId/confirm",
          phase: "transaction",
        },
        contexts: {
          hiring_plan: {
            workspaceId,
            userId,
            hiringPlanId,
            missionId: lookup?.mission_id,
            companyId: lookup?.company_id,
          },
        },
      });
      // Outside production we surface the real cause so the customer
      // (and the dashboard's network panel) can see what actually
      // broke. Production stays generic to avoid leaking schema hints.
      const isProd = process.env.NODE_ENV === "production";
      res.status(500).json({
        error: "Failed to confirm hiring plan",
        ...(isProd ? {} : { detail: message }),
      });
      return;
    }

    res.status(200).json(response);
  });

  return router;
}
