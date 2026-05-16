import { Router } from "express";
import type { Pool } from "pg";
import { listWakeEvents } from "./wakeEventStore";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function parseLimit(raw: unknown): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

export function createWakeEventRoutes(pool: Pool) {
  const router = Router();

  router.get("/", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const agentId =
      typeof req.query.agentId === "string" ? req.query.agentId : undefined;
    const decision =
      typeof req.query.decision === "string" ? req.query.decision : undefined;
    const since =
      typeof req.query.since === "string" ? req.query.since : undefined;
    const limit = parseLimit(req.query.limit);

    try {
      const events = await listWakeEvents(pool, {
        workspaceId,
        userId,
        agentId,
        decision: decision as Parameters<typeof listWakeEvents>[1]["decision"],
        since,
        limit,
      });

      res.json({ events, limit, total: events.length });
    } catch (err) {
      console.error(`[wake-events] query failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to load wake events" });
    }
  });

  return router;
}
