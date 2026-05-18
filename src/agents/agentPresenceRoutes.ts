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
  presenceChannel,
  setAgentPresence,
  tokenPreviewChannel,
  type AgentPresence,
  type AgentPresenceState,
  type AgentTokenPreviewEvent,
} from "./agentPresence";
import { getRedisClient } from "../queue/redisClient";

/**
 * Heartbeat interval for the SSE stream. Reverse proxies (Cloudflare,
 * Fly's load balancer) typically idle out connections at 60-100s with
 * no traffic — sending a comment line well inside that window keeps
 * the stream alive without polluting the client's event log.
 */
const SSE_HEARTBEAT_MS = 15_000;

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

  // -------------------------------------------------------------------------
  // GET /api/agents/presence/stream — Server-Sent Events feed of every
  // presence change in the active workspace. Sends an initial "snapshot"
  // event with the current state, then streams "update" events as the
  // underlying agentPresence Redis key changes (PUBLISH from
  // setAgentPresence). Includes a 15s heartbeat comment so proxies
  // don't close the idle socket.
  //
  // Implementation notes:
  //   - ioredis can only run one subscribe-mode connection at a time on
  //     a given client. We `.duplicate()` here so the main app's BullMQ
  //     traffic on the singleton stays unaffected.
  //   - We tolerate Redis being unavailable: the snapshot still goes out
  //     (it'll be empty), the stream stays open with heartbeats, and a
  //     polling client gets the same data via GET /api/agents/presence.
  // -------------------------------------------------------------------------
  router.get("/presence/stream", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    const send = (event: string, payload: unknown): void => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const initial = await listWorkspaceAgentPresence(workspaceId);
      send("snapshot", { agents: initial });
    } catch (err) {
      console.warn(
        `[agentPresence] snapshot failed for stream ${workspaceId}: ${(err as Error).message}`,
      );
      send("snapshot", { agents: [] });
    }

    const heartbeat = setInterval(() => {
      // SSE comment lines start with `:` and are ignored by EventSource
      // parsers — they only keep the socket warm.
      res.write(`: keep-alive ${Date.now()}\n\n`);
    }, SSE_HEARTBEAT_MS);

    // Duplicate the singleton so we can put this connection in
    // subscribe mode without disabling normal commands elsewhere.
    const base = getRedisClient();
    const sub = base?.duplicate();

    const cleanup = (): void => {
      clearInterval(heartbeat);
      if (sub) {
        // unsubscribe + disconnect — leaks of subscribe-mode
        // connections eat Upstash command quota fast.
        sub.unsubscribe().catch(() => {});
        sub.disconnect();
      }
    };

    if (sub) {
      try {
        // Subscribe to both the durable presence channel and the
        // ephemeral token-preview channel on the same SSE connection.
        // SSE event types differentiate the two on the client.
        const presenceCh = presenceChannel(workspaceId);
        const tokensCh = tokenPreviewChannel(workspaceId);
        await sub.subscribe(presenceCh, tokensCh);
        sub.on("message", (channel: string, message: string) => {
          try {
            if (channel === tokensCh) {
              const parsed = JSON.parse(message) as AgentTokenPreviewEvent;
              send("token", { preview: parsed });
              return;
            }
            const parsed = JSON.parse(message) as AgentPresence;
            send("update", { presence: parsed });
          } catch {
            // Malformed payload from a future producer — drop it
            // rather than terminate the whole stream.
          }
        });
        sub.on("error", (err: Error) => {
          console.warn(`[agentPresence] subscribe error: ${err.message}`);
        });
      } catch (err) {
        console.warn(
          `[agentPresence] subscribe failed: ${(err as Error).message}`,
        );
      }
    }

    req.on("close", cleanup);
    req.on("aborted", cleanup);
  });

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
