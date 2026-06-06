/**
 * Composio connect + OAuth callback routes (HEL-740 / P1b).
 *
 * Two routers, mounted separately in app.ts:
 *  - composioConnectRouter — `POST /connect/:toolkit`, mounted AUTHENTICATED
 *    (requireAuth + workspaceResolver + requireRole) under /api/composio.
 *  - composioCallbackRouter — `GET /callback`, mounted UNAUTHENTICATED under
 *    /api/composio/callback (Composio's redirect carries no session; tenancy is
 *    recovered from the single-use connect-state token).
 */

import { Router, type Request } from "express";
import { asyncHandler } from "../../../middleware/asyncHandler";
import type { WorkspaceAwareRequest } from "../../../middleware/workspaceResolver";
import { isComposioEnabled } from "./config";
import { beginConnect, completeConnect, listConnections, disconnectAccount } from "./connectionService";

/** Build the dashboard redirect target (mirrors oauthBridgeRoutes.dashboardRedirect). */
function dashboardRedirect(params: { status: "success" | "error"; message?: string }): string {
  const base = (process.env.DASHBOARD_APP_URL ?? "http://localhost:5173").replace(/\/$/, "");
  const url = new URL(`${base}/integrations`);
  url.searchParams.set("provider", "composio");
  url.searchParams.set("status", params.status);
  if (params.message) {
    url.searchParams.set("message", params.message);
  }
  return url.toString();
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

/**
 * The public origin of THIS backend, used to build the callbackUrl handed to
 * Composio. Prefer the explicit env (stable behind proxies); fall back to the
 * request's forwarded host.
 */
function callbackBaseUrl(req: Request): string {
  const configured = process.env.COMPOSIO_REDIRECT_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `${req.protocol}://${req.get("host") ?? "localhost"}`;
}

export const composioConnectRouter = Router();

// POST /api/composio/connect/:toolkit — start a connection for a toolkit.
composioConnectRouter.post(
  "/connect/:toolkit",
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
    const toolkit = req.params.toolkit?.trim();
    if (!toolkit) {
      res.status(400).json({ error: "A toolkit is required." });
      return;
    }
    const allowMultiple = req.body?.allowMultiple === true;

    const result = await beginConnect(
      { workspaceId, userId },
      toolkit,
      { callbackBaseUrl: callbackBaseUrl(req), allowMultiple },
    );

    res.status(201).json({
      redirectUrl: result.redirectUrl,
      connectedAccountId: result.connectedAccountId,
      toolkit: result.toolkit,
    });
  }),
);

// GET /api/composio/connections — list the workspace's connections (status reconciled).
composioConnectRouter.get(
  "/connections",
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
    const userId = req.auth?.sub;
    const workspaceId = req.workspaceId;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authentication and workspace context are required." });
      return;
    }
    const connections = await listConnections({ workspaceId, userId });
    res.json({ connections });
  }),
);

// DELETE /api/composio/connections/:caId — disconnect (best-effort revoke + remove local).
composioConnectRouter.delete(
  "/connections/:caId",
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
    const userId = req.auth?.sub;
    const workspaceId = req.workspaceId;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authentication and workspace context are required." });
      return;
    }
    const caId = req.params.caId?.trim();
    if (!caId) {
      res.status(400).json({ error: "A connected account id is required." });
      return;
    }
    const removed = await disconnectAccount({ workspaceId, userId }, caId);
    if (!removed) {
      res.status(404).json({ error: "Connection not found." });
      return;
    }
    res.status(204).end();
  }),
);

export const composioCallbackRouter = Router();

// GET /api/composio/callback — Composio redirects the user here after consent.
composioCallbackRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const result = await completeConnect(firstString(req.query.state), {
      status: firstString(req.query.status),
      connectedAccountId:
        firstString(req.query.connected_account_id) ?? firstString(req.query.connectedAccountId),
    });
    res.redirect(
      dashboardRedirect({
        status: result.status,
        message: result.status === "error" ? result.message : undefined,
      }),
    );
  }),
);
