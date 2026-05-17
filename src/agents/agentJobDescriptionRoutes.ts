/**
 * Job Description wizard route (Wave 3).
 *
 *   POST /api/agents/:agentId/job-description/draft
 *     body: { answers: { mission, decisions, asks, hardRules? } }
 *     returns: { title, body, provider, model }
 *
 * Calls the wizard helper, which talks to the workspace's default LLM
 * and returns a markdown draft. The dashboard then loads the draft
 * into the editor; saving it is a regular write through the existing
 * `/api/instructions` POST/PATCH surface (no new write endpoint here
 * — `workspace_instructions` is the storage substrate).
 */

import { Router } from "express";
import type { Pool } from "pg";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import {
  draftAgentJobDescription,
  type JobDescriptionAnswers,
} from "./jobDescriptionWizard";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AgentRow {
  id: string;
  name: string;
  role_key: string | null;
}

export function createAgentJobDescriptionRoutes(pool: Pool): Router {
  const router = Router();

  router.post("/:agentId/job-description/draft", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const agentId = req.params.agentId;
    if (!agentId || !UUID_RE.test(agentId)) {
      res.status(400).json({ error: "Invalid agent ID format" });
      return;
    }

    const body = req.body as { answers?: unknown };
    const answers = body?.answers as JobDescriptionAnswers | undefined;
    if (!answers || typeof answers !== "object") {
      res.status(400).json({ error: "answers object is required" });
      return;
    }

    // Pull the agent's name + role from the DB so the wizard prompt
    // can address them by name. Workspace-scoped lookup so a caller
    // can't ask the wizard about an agent that doesn't belong to
    // them. Falls back to a generic name if the agent isn't found
    // yet (e.g. the dashboard is calling immediately after a hire
    // plan confirm before the read replica catches up).
    let agent: AgentRow | null = null;
    try {
      agent = await withWorkspaceContext(
        pool,
        { workspaceId, userId },
        async (client) => {
          const result = await client.query<AgentRow>(
            `SELECT id, name, role_key
               FROM agents
              WHERE id = $1 AND workspace_id = $2
              LIMIT 1`,
            [agentId, workspaceId],
          );
          return result.rows[0] ?? null;
        },
      );
    } catch (err) {
      console.warn(
        `[jobDescriptionWizard] agent lookup failed: ${(err as Error).message}`,
      );
      // Soft-fail; the wizard can still run with a generic name.
    }

    try {
      const draft = await draftAgentJobDescription(
        userId,
        {
          agentName: agent?.name ?? "Your agent",
          agentRoleKey: agent?.role_key ?? null,
          answers,
        },
        pool,
      );
      res.json({
        title: draft.title,
        body: draft.body,
        provider: draft.provider,
        model: draft.model,
      });
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "VALIDATION") {
        res.status(400).json({ error: (err as Error).message });
        return;
      }
      if (code === "NO_PROVIDER") {
        res.status(422).json({ error: (err as Error).message });
        return;
      }
      // LLM_FAILED (or unknown) → 502 with the provider/model already
      // in the message string.
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
