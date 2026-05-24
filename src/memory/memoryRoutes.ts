/**
 * Memory API routes.
 *
 * All routes require authenticated user context (req.auth.sub) for scoping.
 *
 *   POST   /api/memory               — write (create/upsert) a memory entry
 *   GET    /api/memory               — list all entries for the user
 *   GET    /api/memory/search        — semantic/keyword search
 *   GET    /api/memory/stats         — usage stats (entry count, bytes)
 *   DELETE /api/memory/:id           — delete a single entry
 *
 * DASH-44: memoryStore is now Postgres-backed. Handlers are async.
 */

import { Router } from "express";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { memoryStore } from "../engine/memoryStore";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function resolveUserId(req: AuthenticatedRequest): string | null {
  const userId = req.auth?.sub;
  return typeof userId === "string" && userId.trim() ? userId : null;
}

// ---------------------------------------------------------------------------
// POST /api/memory — write entry
// ---------------------------------------------------------------------------

router.post("/", asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const { key, text, workflowId, workflowName, agentId, ttlSeconds } = req.body as {
    key?: unknown;
    text?: unknown;
    workflowId?: unknown;
    workflowName?: unknown;
    agentId?: unknown;
    ttlSeconds?: unknown;
  };

  if (typeof key !== "string" || !key.trim()) {
    res.status(400).json({ error: "key is required and must be a non-empty string" });
    return;
  }
  if (typeof text !== "string") {
    res.status(400).json({ error: "text is required and must be a string" });
    return;
  }
  if (ttlSeconds !== undefined && (typeof ttlSeconds !== "number" || ttlSeconds <= 0)) {
    res.status(400).json({ error: "ttlSeconds must be a positive number when provided" });
    return;
  }

  const entry = await memoryStore.write({
    userId,
    key,
    text,
    workflowId: typeof workflowId === "string" ? workflowId : undefined,
    workflowName: typeof workflowName === "string" ? workflowName : undefined,
    agentId: typeof agentId === "string" ? agentId : undefined,
    ttlSeconds: typeof ttlSeconds === "number" ? ttlSeconds : undefined,
  });

  res.status(201).json(entry);
}));

// ---------------------------------------------------------------------------
// GET /api/memory/stats — usage stats (must precede /:id route)
// ---------------------------------------------------------------------------

router.get("/stats", asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }
  res.json(await memoryStore.stats(userId));
}));

// ---------------------------------------------------------------------------
// GET /api/memory/search — keyword/semantic search
// ---------------------------------------------------------------------------

router.get("/search", asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const { q, agentId, limit } = req.query;
  const query = typeof q === "string" ? q : "";
  const agentFilter = typeof agentId === "string" ? agentId : undefined;
  const limitNum = typeof limit === "string" ? Math.min(parseInt(limit, 10) || 10, 100) : 10;

  const results = await memoryStore.search(query, userId, agentFilter, limitNum);
  res.json({ results, total: results.length });
}));

// ---------------------------------------------------------------------------
// GET /api/memory — list all entries
// ---------------------------------------------------------------------------

router.get("/", asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const { workflowId } = req.query;
  const entries = await memoryStore.list(
    userId,
    typeof workflowId === "string" ? workflowId : undefined
  );
  res.json({ entries, total: entries.length });
}));

// ---------------------------------------------------------------------------
// HEL-214 / PR J scaffold — GET /api/memory/episodes?as_of=ISO_DATE
//
// TODO: HEL-214 wire real implementation. Pro Mode's EpisodeScrubber
// surfaces episodes (run + activity bundles) at a chosen timestamp; the
// real handler will roll up `episodes` + `runs` against the as_of cursor.
// Today we return a small synthetic list so the slider plumbing renders.
// ---------------------------------------------------------------------------

router.get("/episodes", asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const asOfRaw = typeof req.query.as_of === "string" ? req.query.as_of : null;
  const asOf = asOfRaw ? new Date(asOfRaw) : new Date();
  if (Number.isNaN(asOf.getTime())) {
    res.status(400).json({ error: "as_of must be a valid ISO date string" });
    return;
  }

  const baseMs = asOf.getTime();
  res.json({
    asOf: asOf.toISOString(),
    episodes: [
      {
        id: "ep_scaffold_1",
        label: "Onboarding sync - Marketing pod",
        startedAt: new Date(baseMs - 2 * 60 * 60 * 1000).toISOString(),
        endedAt: new Date(baseMs - 60 * 60 * 1000).toISOString(),
        agentId: "ag_demo_marketing_lead",
      },
      {
        id: "ep_scaffold_2",
        label: "Mission planning - refinement",
        startedAt: new Date(baseMs - 30 * 60 * 1000).toISOString(),
        endedAt: null,
        agentId: "ag_demo_strategist",
      },
    ],
  });
}));

// ---------------------------------------------------------------------------
// DELETE /api/memory/:id — delete entry
// ---------------------------------------------------------------------------

router.delete("/:id", asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const removed = await memoryStore.delete(req.params.id, userId);
  if (!removed) {
    res.status(404).json({ error: "Memory entry not found or not owned by you" });
    return;
  }

  res.status(204).end();
}));

export default router;
