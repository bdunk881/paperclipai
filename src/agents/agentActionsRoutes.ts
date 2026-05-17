/**
 * Agent action routes (Wave 5).
 *
 *   POST /api/agents/:agentId/check-in
 *     "Wake up and review your current work, flag any blockers."
 *     Creates a mission_assignment (ticket) assigned to the agent
 *     and flips presence to "checking-in" so the dashboard pill
 *     reflects the request immediately. Idempotency-locked through
 *     Redis (30s window) so a double-click doesn't create two
 *     tickets.
 *
 *   POST /api/agents/:agentId/handoff
 *     "Here's a specific task I'm assigning you." Owner provides
 *     title + optional description + priority + dueDate; backend
 *     creates a mission_assignment assigned to the agent. No
 *     idempotency lock — each call is a distinct task.
 *
 * Both endpoints produce a `tickets` row through the existing
 * ticketStore. Naming the user-facing concept "mission assignment"
 * (see PR #825) is purely a label change — internal storage is
 * unchanged.
 */

import { Router } from "express";
import type { Pool } from "pg";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import { ticketStore, type TicketPriority } from "../tickets/ticketStore";
import { getRedisClient } from "../queue/redisClient";
import { setAgentPresence } from "./agentPresence";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_PRIORITIES: ReadonlySet<TicketPriority> = new Set([
  "low",
  "medium",
  "high",
  "urgent",
]);

function isPriority(value: unknown): value is TicketPriority {
  return typeof value === "string" && VALID_PRIORITIES.has(value as TicketPriority);
}

const CHECK_IN_LOCK_TTL_SECONDS = 30;

interface AgentRow {
  id: string;
  name: string;
}

async function loadAgent(
  pool: Pool,
  workspaceId: string,
  userId: string,
  agentId: string,
): Promise<AgentRow | null> {
  try {
    return await withWorkspaceContext(
      pool,
      { workspaceId, userId },
      async (client) => {
        const result = await client.query<AgentRow>(
          `SELECT id, name FROM agents
            WHERE id = $1 AND workspace_id = $2
            LIMIT 1`,
          [agentId, workspaceId],
        );
        return result.rows[0] ?? null;
      },
    );
  } catch (err) {
    console.warn(
      `[agentActions] agent lookup failed: ${(err as Error).message}`,
    );
    return null;
  }
}

export function createAgentActionsRoutes(pool: Pool): Router {
  const router = Router();

  router.post("/:agentId/check-in", async (req: AuthenticatedRequest, res) => {
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

    // Idempotency: a 30s Redis SET NX EX lock keyed by workspace +
    // agent prevents a double-click from creating two tickets. Best-
    // effort — if Redis is offline, fall through to creating the ticket.
    const redis = getRedisClient();
    if (redis) {
      try {
        const lockKey = `agent:${workspaceId}:${agentId}:check-in-lock`;
        const acquired = await redis.set(
          lockKey,
          String(Date.now()),
          "EX",
          CHECK_IN_LOCK_TTL_SECONDS,
          "NX",
        );
        if (acquired === null) {
          res.status(429).json({
            error: "A check-in for this agent was just requested. Wait a few seconds.",
          });
          return;
        }
      } catch (err) {
        console.warn(
          `[agentActions] check-in lock failed (continuing): ${(err as Error).message}`,
        );
      }
    }

    const agent = await loadAgent(pool, workspaceId, userId, agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    try {
      const aggregate = await ticketStore.create({
        workspaceId,
        title: `Self check-in: ${agent.name} reviews current work`,
        description:
          "The owner requested a check-in. Review what you're currently working on, flag any blockers, and confirm next steps.",
        creatorId: userId,
        priority: "medium",
        assignees: [{ type: "agent", id: agent.id, role: "primary" }],
        context: { workspaceId, userId },
      });

      // Best-effort presence flip so the dashboard pill animates.
      // setAgentPresence already swallows Redis errors.
      void setAgentPresence({
        workspaceId,
        agentId: agent.id,
        state: "checking-in",
        currentTask: "Self check-in",
      });

      res.status(201).json({
        ticketId: aggregate.ticket.id,
        agentId: agent.id,
        agentName: agent.name,
      });
    } catch (err) {
      console.error(
        `[agentActions] check-in ticket create failed: ${(err as Error).message}`,
      );
      res.status(500).json({ error: "Failed to start check-in" });
    }
  });

  router.post("/:agentId/handoff", async (req: AuthenticatedRequest, res) => {
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

    const body = req.body as {
      title?: unknown;
      description?: unknown;
      priority?: unknown;
      dueDate?: unknown;
    };

    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (!title) {
      res.status(400).json({ error: "title is required" });
      return;
    }
    if (title.length > 200) {
      res.status(400).json({ error: "title must be ≤ 200 characters" });
      return;
    }

    const description =
      typeof body.description === "string" ? body.description.trim() : undefined;
    if (description && description.length > 10_000) {
      res.status(400).json({ error: "description must be ≤ 10000 characters" });
      return;
    }

    const priority: TicketPriority = isPriority(body.priority) ? body.priority : "medium";
    const dueDate = typeof body.dueDate === "string" && body.dueDate ? body.dueDate : undefined;

    const agent = await loadAgent(pool, workspaceId, userId, agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    try {
      const aggregate = await ticketStore.create({
        workspaceId,
        title,
        description,
        creatorId: userId,
        priority,
        dueDate,
        assignees: [{ type: "agent", id: agent.id, role: "primary" }],
        context: { workspaceId, userId },
      });

      res.status(201).json({
        ticketId: aggregate.ticket.id,
        agentId: agent.id,
        agentName: agent.name,
      });
    } catch (err) {
      console.error(
        `[agentActions] hand-off ticket create failed: ${(err as Error).message}`,
      );
      res.status(500).json({ error: "Failed to hand off task" });
    }
  });

  return router;
}
