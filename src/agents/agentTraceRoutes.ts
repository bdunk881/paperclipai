/**
 * SSE + replay for live agent turn traces.
 */

import { Router } from "express";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import { getRedisClient } from "../queue/redisClient";
import { agentTraceChannel } from "../engine/agentTrace/tracePublisher";
import type { AgentTraceEnvelope } from "../engine/agentTrace/types";
import { subscribeAgentTraceInMemory } from "../engine/agentTrace/tracePublisher";
import { listAgentTraceEvents } from "./agentTraceStore";
import { getPostgresPool, isPostgresPersistenceEnabled } from "../db/postgres";
import { asyncHandler } from "../middleware/asyncHandler";

const SSE_HEARTBEAT_MS = 15_000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createAgentTraceRoutes(): Router {
  const router = Router({ mergeParams: true });

  router.get(
    "/:runId/trace/stream",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = req.auth?.sub;
      const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
      const runId = req.params.runId;
      if (!userId || !workspaceId) {
        res.status(401).json({ error: "Authenticated user + workspace required" });
        return;
      }
      if (!UUID_RE.test(runId)) {
        res.status(400).json({ error: "Invalid run id" });
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

      const pool = isPostgresPersistenceEnabled() ? getPostgresPool() : null;
      try {
        const replay = await listAgentTraceEvents(pool, workspaceId, runId, 0);
        send("snapshot", { events: replay });
      } catch (err) {
        console.warn(
          `[agentTrace] snapshot failed run=${runId}: ${(err as Error).message}`,
        );
        send("snapshot", { events: [] });
      }

      const heartbeat = setInterval(() => {
        res.write(`: keep-alive ${Date.now()}\n\n`);
      }, SSE_HEARTBEAT_MS);

      let lastSeq = 0;
      const onEnvelope = (envelope: AgentTraceEnvelope): void => {
        if (envelope.runId !== runId || envelope.workspaceId !== workspaceId) return;
        if (envelope.seq <= lastSeq) return;
        lastSeq = envelope.seq;
        send("trace", envelope);
      };

      const unsubscribeMemory = subscribeAgentTraceInMemory(
        workspaceId,
        runId,
        onEnvelope,
      );

      const base = getRedisClient();
      const sub = base?.duplicate();
      let closed = false;

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribeMemory();
        sub?.disconnect();
      };

      req.on("close", cleanup);

      if (sub) {
        try {
          await sub.subscribe(agentTraceChannel(workspaceId));
          sub.on("message", (_channel, message) => {
            try {
              const envelope = JSON.parse(message) as AgentTraceEnvelope;
              onEnvelope(envelope);
            } catch {
              // Ignore malformed payloads.
            }
          });
        } catch (err) {
          console.warn(
            `[agentTrace] subscribe failed run=${runId}: ${(err as Error).message}`,
          );
        }
      }
    }),
  );

  router.get(
    "/:runId/trace",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
      const runId = req.params.runId;
      if (!workspaceId) {
        res.status(401).json({ error: "Workspace required" });
        return;
      }
      if (!UUID_RE.test(runId)) {
        res.status(400).json({ error: "Invalid run id" });
        return;
      }
      const afterSeq = Number.parseInt(String(req.query.afterSeq ?? "0"), 10) || 0;
      const pool = isPostgresPersistenceEnabled() ? getPostgresPool() : null;
      const events = await listAgentTraceEvents(pool, workspaceId, runId, afterSeq);
      res.json({ events });
    }),
  );

  return router;
}
