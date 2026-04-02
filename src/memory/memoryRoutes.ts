/**
 * Memory API routes.
 *
 * All routes require a valid Bearer JWT (Entra External ID).
 * User identity is derived from the verified JWT sub claim.
 *
 *   POST   /api/memory               — write (create/upsert) a memory entry
 *   GET    /api/memory               — list all entries for the user
 *   GET    /api/memory/search        — semantic/keyword search
 *   GET    /api/memory/stats         — usage stats (entry count, bytes)
 *   DELETE /api/memory/:id           — delete a single entry
 */

import { Router } from "express";
import { memoryStore } from "../engine/memoryStore";
import { requireAuth, AuthenticatedRequest } from "../auth/authMiddleware";

const router = Router();

// All memory routes require JWT auth
router.use(requireAuth);

// ---------------------------------------------------------------------------
// POST /api/memory — write entry
// ---------------------------------------------------------------------------

router.post("/", (req: AuthenticatedRequest, res) => {
  const userId = req.auth!.sub;

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

  const entry = memoryStore.write({
    userId,
    key,
    text,
    workflowId: typeof workflowId === "string" ? workflowId : undefined,
    workflowName: typeof workflowName === "string" ? workflowName : undefined,
    agentId: typeof agentId === "string" ? agentId : undefined,
    ttlSeconds: typeof ttlSeconds === "number" ? ttlSeconds : undefined,
  });

  res.status(201).json(entry);
});

// ---------------------------------------------------------------------------
// GET /api/memory/stats — usage stats (must precede /:id route)
// ---------------------------------------------------------------------------

router.get("/stats", (req: AuthenticatedRequest, res) => {
  res.json(memoryStore.stats(req.auth!.sub));
});

// ---------------------------------------------------------------------------
// GET /api/memory/search — keyword/semantic search
// ---------------------------------------------------------------------------

router.get("/search", (req: AuthenticatedRequest, res) => {
  const { q, agentId, limit } = req.query;
  const query = typeof q === "string" ? q : "";
  const agentFilter = typeof agentId === "string" ? agentId : undefined;
  const limitNum = typeof limit === "string" ? Math.min(parseInt(limit, 10) || 10, 100) : 10;

  const results = memoryStore.search(query, req.auth!.sub, agentFilter, limitNum);
  res.json({ results, total: results.length });
});

// ---------------------------------------------------------------------------
// GET /api/memory — list all entries
// ---------------------------------------------------------------------------

router.get("/", (req: AuthenticatedRequest, res) => {
  const { workflowId } = req.query;
  const entries = memoryStore.list(
    req.auth!.sub,
    typeof workflowId === "string" ? workflowId : undefined
  );
  res.json({ entries, total: entries.length });
});

// ---------------------------------------------------------------------------
// DELETE /api/memory/:id — delete entry
// ---------------------------------------------------------------------------

router.delete("/:id", (req: AuthenticatedRequest, res) => {
  const removed = memoryStore.delete(req.params.id, req.auth!.sub);
  if (!removed) {
    res.status(404).json({ error: "Memory entry not found or not owned by you" });
    return;
  }

  res.status(204).end();
});

export default router;
