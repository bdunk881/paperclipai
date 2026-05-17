/**
 * Agent presence routes (Wave 2a).
 *
 * Surfaces the Redis-backed live-status layer in agentPresence.ts to
 * the dashboard. Read endpoints are polling-friendly today; a follow-up
 * (Wave 2b) adds a Server-Sent Events stream backed by Redis pub/sub
 * so the UI doesn't have to poll.
 *
 *   GET  /api/agents/presence                  → list every live agent
 *                                                in the workspace
 *   GET  /api/agents/:agentId/presence         → single agent state
 *   POST /api/agents/:agentId/presence         → caller updates the
 *                                                agent's state (state,
 *                                                currentTask?)
 *
 * The POST is open to anyone with workspace access today — that's
 * fine for Wave 2a (the engine handler is the only intended caller).
 * Tighter ACL (e.g. require the agent's own service token) comes
 * with Wave 5's Check-in / Hand-off endpoints.
 */

import { Router } from "express";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import {
  getAgentPresence,
  listWorkspaceAgentPresence,
  setAgentPresence,
  type AgentPresenceState,
} from "./agentPresence";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_STATES: ReadonlySet<AgentPresenceState> = new Set([
  "working",
  "idle",
  "blocked",
  "checking-in",
]);

function isValidState(value: unknown): value is AgentPresenceState {
  return typeof value === "string" && VALID_STATES.has(value as AgentPresenceState);
}

export function createAgentPresenceRoutes(): Router {
  const router = Router();

  router.get("/presence", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    try {
      const agents = await listWorkspaceAgentPresence(workspaceId);
      res.json({ agents });
    } catch (err) {
      console.error(
        `[agentPresence] list failed: ${(err as Error).message}`,
      );
      res.status(500).json({ error: "Failed to load agent presence" });
    }
  });

  router.get("/:agentId/presence", async (req: AuthenticatedRequest, res) => {
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

    try {
      const presence = await getAgentPresence(workspaceId, agentId);
      if (!presence) {
        // Empty 200 rather than 404 — "no presence" is a valid state
        // (the agent's TTL lapsed; they're considered offline).
        res.json({ presence: null });
        return;
      }
      res.json({ presence });
    } catch (err) {
      console.error(
        `[agentPresence] get failed: ${(err as Error).message}`,
      );
      res.status(500).json({ error: "Failed to load agent presence" });
    }
  });

  router.post("/:agentId/presence", async (req: AuthenticatedRequest, res) => {
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

    const body = req.body as { state?: unknown; currentTask?: unknown };
    if (!isValidState(body?.state)) {
      res.status(400).json({
        error: `state must be one of: ${Array.from(VALID_STATES).join(", ")}`,
      });
      return;
    }
    const currentTask =
      typeof body.currentTask === "string" ? body.currentTask : null;

    try {
      const presence = await setAgentPresence({
        workspaceId,
        agentId,
        state: body.state,
        currentTask,
      });
      res.json({ presence });
    } catch (err) {
      console.error(
        `[agentPresence] set failed: ${(err as Error).message}`,
      );
      res.status(500).json({ error: "Failed to update agent presence" });
    }
  });

  return router;
}
