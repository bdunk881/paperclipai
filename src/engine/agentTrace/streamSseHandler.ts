/**
 * Shared SSE handler for workspace-stream subscriptions.
 *
 * Wraps the boilerplate every per-resource and firehose endpoint would
 * otherwise duplicate — Content-Type + heartbeat + Redis subscribe +
 * in-memory subscriber + cleanup on disconnect. Callers supply a filter
 * predicate that determines which envelopes get forwarded to this
 * particular client.
 */

import type { Request, Response } from "express";
import { getRedisClient } from "../../queue/redisClient";
import {
  agentStreamChannel,
  subscribeAgentStreamInMemory,
  type WorkspaceStreamEnvelope,
} from "./streamPublisher";

const SSE_HEARTBEAT_MS = 15_000;

export interface StreamSseOptions {
  workspaceId: string;
  /** Return `true` to forward the envelope to this client. */
  filter: (envelope: WorkspaceStreamEnvelope) => boolean;
  /** Optional one-shot snapshot payload sent on connect. */
  snapshot?: () => Promise<unknown> | unknown;
}

export async function handleStreamSse(
  req: Request,
  res: Response,
  options: StreamSseOptions,
): Promise<void> {
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

  if (options.snapshot) {
    try {
      const snap = await options.snapshot();
      send("snapshot", snap);
    } catch (err) {
      console.warn(`[agentStream] snapshot failed: ${(err as Error).message}`);
      send("snapshot", null);
    }
  }

  const heartbeat = setInterval(() => {
    res.write(`: keep-alive ${Date.now()}\n\n`);
  }, SSE_HEARTBEAT_MS);

  let lastSeq = 0;
  const onEnvelope = (envelope: WorkspaceStreamEnvelope): void => {
    if (envelope.workspaceId !== options.workspaceId) return;
    if (envelope.seq <= lastSeq) return;
    if (!options.filter(envelope)) return;
    lastSeq = envelope.seq;
    send("stream", envelope);
  };

  const unsubscribeMemory = subscribeAgentStreamInMemory(
    options.workspaceId,
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
      await sub.subscribe(agentStreamChannel(options.workspaceId));
      sub.on("message", (_channel, message) => {
        try {
          const envelope = JSON.parse(message) as WorkspaceStreamEnvelope;
          onEnvelope(envelope);
        } catch {
          // Ignore malformed payloads.
        }
      });
    } catch (err) {
      console.warn(
        `[agentStream] subscribe failed ws=${options.workspaceId}: ${(err as Error).message}`,
      );
    }
  }
}
