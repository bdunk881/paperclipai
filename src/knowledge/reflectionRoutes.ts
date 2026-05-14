/**
 * Reflection endpoint (HEL-91).
 *
 * `POST /api/knowledge/reflect` — manual "Run consolidation now" trigger.
 * Authenticated workspace admin runs it on demand; v1 has no automation
 * (activity-gated automatic reflection lands in P3).
 */

import { Router } from "express";
import type { Pool } from "pg";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import { runReflection, type ReflectionPromptOutput } from "./reflectionJob";

export interface ReflectionRouteDeps {
  /**
   * Caller provides the LLM hook (uses the tier router + provider adapters
   * from HEL-81 + HEL-82). v1 ships an inline stub when no LLM is configured;
   * see the default below.
   */
  llmReflect?: (input: {
    workspaceContext: string;
    episodes: Array<{ id: string; title: string; summary: string; createdAt: string }>;
  }) => Promise<ReflectionPromptOutput | null>;
  embedFn?: (text: string) => Promise<number[]>;
}

/**
 * Default LLM-reflect stub: returns null so the run completes without
 * synthesizing anything. Useful in dev/test where no LLM is configured.
 * Production overrides this when wired by app.ts.
 */
const NULL_REFLECT: Required<ReflectionRouteDeps>["llmReflect"] = async () => null;
const STUB_EMBED: Required<ReflectionRouteDeps>["embedFn"] = async () => [];

export function createReflectionRoutes(pool: Pool, deps: ReflectionRouteDeps = {}): Router {
  const router = Router();

  // POST /api/knowledge/reflect
  // body: { lookback_days?: number, workspace_context?: string }
  router.post("/", async (req: WorkspaceAwareRequest, res) => {
    const workspaceId = req.workspace?.id;
    const userId = req.auth?.sub;
    if (!workspaceId || !userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const body = req.body ?? {};
    const lookbackDays =
      typeof body.lookback_days === "number" && body.lookback_days > 0 && body.lookback_days <= 90
        ? Math.floor(body.lookback_days)
        : 14;
    const workspaceContext =
      typeof body.workspace_context === "string" ? body.workspace_context.slice(0, 2000) : "";

    try {
      const result = await runReflection(
        {
          pool,
          llmReflect: deps.llmReflect ?? NULL_REFLECT,
          embedFn: deps.embedFn ?? STUB_EMBED,
        },
        {
          workspaceId,
          userId,
          lookbackDays,
          workspaceContext,
        },
      );

      return res.json({
        clustersFound: result.clustersFound,
        itemsCreated: result.itemsCreated,
        episodesProcessed: result.episodesProcessed,
        insertedItemIds: result.insertedItemIds,
      });
    } catch (err) {
      console.error("[reflection] run failed:", (err as Error).message);
      return res.status(500).json({ error: "Reflection run failed" });
    }
  });

  return router;
}
