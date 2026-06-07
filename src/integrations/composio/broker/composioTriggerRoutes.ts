/**
 * Composio trigger CRUD routes (HEL-767 / P4-c).
 *
 * Mounted under /api/composio (requireAuth + workspaceResolver +
 * requireRole("admin","developer")), alongside composioConnectRouter. Wraps the
 * P4-a subscription service so the dashboard picker (P4-d) can list trigger
 * types, subscribe a trigger bound to an agent, list, and delete.
 */

import { Router } from "express";
import { asyncHandler } from "../../../middleware/asyncHandler";
import type { WorkspaceAwareRequest } from "../../../middleware/workspaceResolver";
import { withWorkspaceContext } from "../../../middleware/workspaceContext";
import { getPostgresPool, isPostgresConfigured } from "../../../db/postgres";
import { isComposioEnabled } from "./config";
import {
  enableTrigger,
  deleteTrigger,
  getTriggerType,
  listTriggerTypes,
} from "./triggerSubscriptionService";
import { triggerInstanceStore } from "./triggerInstanceStore";

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

/**
 * Workspace-ownership guard for the bound agent — a trigger must wake an agent in
 * the caller's OWN workspace (else a fired trigger would cross tenants at dispatch).
 * Enforced when Postgres is configured; skipped in dev/test (no RLS DB to check).
 */
async function agentInWorkspace(
  ctx: { workspaceId: string; userId: string },
  agentId: string,
): Promise<boolean> {
  if (!isPostgresConfigured()) return true;
  return withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
    const r = await client.query(`SELECT 1 FROM agents WHERE id = $1 AND workspace_id = $2`, [
      agentId,
      ctx.workspaceId,
    ]);
    return (r.rowCount ?? 0) > 0;
  });
}

export const composioTriggerRouter = Router();

// GET /api/composio/triggers/types?toolkit=github — a toolkit's trigger types (picker).
composioTriggerRouter.get(
  "/triggers/types",
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
    if (!isComposioEnabled()) {
      res.status(503).json({ error: "Composio is not enabled." });
      return;
    }
    const toolkit = firstString(req.query.toolkit)?.trim();
    if (!toolkit) {
      res.status(400).json({ error: "A toolkit query param is required." });
      return;
    }
    res.json({ types: await listTriggerTypes(toolkit) });
  }),
);

// GET /api/composio/triggers/types/:slug — one trigger type's config/payload schema.
composioTriggerRouter.get(
  "/triggers/types/:slug",
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
    if (!isComposioEnabled()) {
      res.status(503).json({ error: "Composio is not enabled." });
      return;
    }
    const slug = req.params.slug?.trim();
    if (!slug) {
      res.status(400).json({ error: "A trigger slug is required." });
      return;
    }
    res.json({ type: await getTriggerType(slug) });
  }),
);

// GET /api/composio/triggers — list the workspace's trigger subscriptions.
composioTriggerRouter.get(
  "/triggers",
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
    const userId = req.auth?.sub;
    const workspaceId = req.workspaceId;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authentication and workspace context are required." });
      return;
    }
    const triggers = await triggerInstanceStore.listByWorkspace({ workspaceId, userId });
    res.json({ triggers });
  }),
);

// POST /api/composio/triggers — subscribe a trigger and bind it to an agent.
composioTriggerRouter.post(
  "/triggers",
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
    if (!isComposioEnabled()) {
      res.status(503).json({ error: "Composio is not enabled." });
      return;
    }
    const userId = req.auth?.sub;
    const workspaceId = req.workspaceId;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authentication and workspace context are required." });
      return;
    }
    const body = (req.body ?? {}) as {
      toolkit?: unknown;
      slug?: unknown;
      agentId?: unknown;
      triggerConfig?: unknown;
      connectionId?: unknown;
    };
    const toolkit = typeof body.toolkit === "string" ? body.toolkit.trim() : "";
    const slug = typeof body.slug === "string" ? body.slug.trim() : "";
    const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
    if (!toolkit || !slug || !agentId) {
      res.status(400).json({ error: "toolkit, slug, and agentId are required." });
      return;
    }
    if (!(await agentInWorkspace({ workspaceId, userId }, agentId))) {
      res.status(404).json({ error: "Agent not found in this workspace." });
      return;
    }
    const triggerConfig =
      body.triggerConfig && typeof body.triggerConfig === "object"
        ? (body.triggerConfig as Record<string, unknown>)
        : undefined;
    const connectionId =
      typeof body.connectionId === "string" ? body.connectionId.trim() : undefined;

    const trigger = await enableTrigger({
      workspaceId,
      userId,
      agentId,
      toolkit,
      slug,
      triggerConfig,
      connectionId,
    });
    res.status(201).json({ trigger });
  }),
);

// DELETE /api/composio/triggers/:triggerId — disable + delete a subscription.
composioTriggerRouter.delete(
  "/triggers/:triggerId",
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
    if (!isComposioEnabled()) {
      res.status(503).json({ error: "Composio is not enabled." });
      return;
    }
    const userId = req.auth?.sub;
    const workspaceId = req.workspaceId;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authentication and workspace context are required." });
      return;
    }
    const triggerId = req.params.triggerId?.trim();
    if (!triggerId) {
      res.status(400).json({ error: "A trigger id is required." });
      return;
    }
    const removed = await deleteTrigger({ workspaceId, userId }, triggerId);
    if (!removed) {
      res.status(404).json({ error: "Trigger not found." });
      return;
    }
    res.status(204).end();
  }),
);
