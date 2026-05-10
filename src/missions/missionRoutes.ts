/**
 * Mission routes (HEL-24).
 *
 * POST /api/missions/:missionId/generate-plan
 *
 *   Reads the mission row, builds a teamAssembly request from the mission
 *   statement, calls the workspace's default LLM, and persists the response
 *   as a `hiring_plans` draft (status='pending_review'). Returns the
 *   hiring_plan id + the structured plan.
 *
 * Reuses the existing `src/goals/teamAssembly.ts` prompt + parser — that
 * module already shipped a working schema, structured-output prompt, and
 * response parser; HEL-24 just adapts it to the mission-rooted model
 * (mission.statement → normalizedGoalDocument.goal) and wires the
 * persistence layer (HEL-13's hiring_plans table).
 */

import { Router } from "express";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import {
  buildTeamAssemblyPrompt,
  DEFAULT_ROLE_LIBRARY,
  parseTeamAssemblyResponse,
  TEAM_ASSEMBLY_SCHEMA_VERSION,
  type TeamAssemblyRequest,
  type TeamAssemblyResult,
} from "../goals/teamAssembly";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { resolveModelForTier } from "../engine/llmModels";
import { getProvider } from "../engine/llmProviders";

interface MissionRow {
  id: string;
  company_id: string;
  statement: string;
  workspace_id: string;
  company_name: string | null;
}

async function loadMissionScopedToWorkspace(
  pool: Pool,
  missionId: string,
  workspaceId: string,
): Promise<MissionRow | null> {
  const result = await withWorkspaceContext(
    pool,
    { workspaceId, userId: "mission-route" },
    async (client) =>
      client.query<MissionRow>(
        `SELECT m.id, m.company_id, m.statement, c.workspace_id, c.name AS company_name
           FROM missions m
           JOIN companies c ON c.id = m.company_id
          WHERE m.id = $1
          LIMIT 1`,
        [missionId],
      ),
  );
  if (result.rows.length === 0) return null;
  return result.rows[0];
}

/**
 * Builds a teamAssembly request from a mission. The mission carries only
 * the goal statement; the rest of the normalizedGoalDocument is filled
 * with defensible defaults that signal "we don't know this yet" rather
 * than fabricating numbers the LLM might anchor on.
 */
function teamAssemblyRequestFromMission(mission: MissionRow): TeamAssemblyRequest {
  return {
    companyName: mission.company_name ?? undefined,
    normalizedGoalDocument: {
      sourceType: "free_text",
      goal: mission.statement,
      targetCustomer: null,
      successMetrics: [],
      constraints: [],
      budget: null,
      timeHorizon: null,
      planReadinessThreshold: 0.6,
    },
    roleLibrary: [...DEFAULT_ROLE_LIBRARY],
  };
}

async function persistHiringPlanDraft(
  pool: Pool,
  workspaceId: string,
  missionId: string,
  draft: TeamAssemblyResult,
): Promise<string> {
  const id = randomUUID();
  await withWorkspaceContext(
    pool,
    { workspaceId, userId: "mission-route" },
    async (client) =>
      client.query(
        `INSERT INTO hiring_plans (id, mission_id, draft)
            VALUES ($1, $2, $3::jsonb)`,
        [id, missionId, JSON.stringify(draft)],
      ),
  );
  return id;
}

export function createMissionRoutes(pool: Pool) {
  const router = Router();

  router.post("/:missionId/generate-plan", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as AuthenticatedRequest & { workspace?: { id: string } }).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const missionId = req.params.missionId;
    if (!missionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(missionId)) {
      res.status(400).json({ error: "Invalid mission ID format" });
      return;
    }

    let mission: MissionRow | null;
    try {
      mission = await loadMissionScopedToWorkspace(pool, missionId, workspaceId);
    } catch (err) {
      console.error(`[missions] mission lookup failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Mission lookup failed" });
      return;
    }
    if (!mission) {
      res.status(404).json({ error: "Mission not found" });
      return;
    }

    const resolved = await llmConfigStore.getDecryptedDefault(userId);
    if (!resolved) {
      res.status(422).json({
        error: "No LLM provider configured. Go to Settings > LLM Providers to connect one.",
      });
      return;
    }

    const assemblyModel = resolveModelForTier(resolved.config.provider, "power");
    const provider = getProvider({
      provider: resolved.config.provider,
      model: assemblyModel,
      apiKey: resolved.apiKey,
    });

    const request = teamAssemblyRequestFromMission(mission);
    let rawText: string;
    try {
      rawText = (await provider(buildTeamAssemblyPrompt(request))).text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `LLM call failed: ${msg}` });
      return;
    }

    let plan: TeamAssemblyResult;
    try {
      plan = parseTeamAssemblyResponse(rawText);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[missions] plan parse failed: ${msg}`);
      res.status(502).json({ error: `Plan parse failed: ${msg}` });
      return;
    }

    let hiringPlanId: string;
    try {
      hiringPlanId = await persistHiringPlanDraft(pool, workspaceId, missionId, plan);
    } catch (err) {
      console.error(`[missions] hiring plan persist failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to persist hiring plan" });
      return;
    }

    res.json({
      hiringPlanId,
      missionId,
      schemaVersion: TEAM_ASSEMBLY_SCHEMA_VERSION,
      plan,
    });
  });

  return router;
}
