/**
 * Embedded bull-board mount for the Compute tab (HEL infra dashboard PR #2).
 *
 * Mounts @bull-board/express under /api/admin-console/infra/queues/_ui so
 * the React app can iframe it for the "Bull-Board (expert)" sub-tab.
 * PR #2 ships in `readOnlyMode: true` (no retry / promote / clean buttons);
 * PR #6 flips this off when the mutation routes land.
 *
 * Auth: the parent router (createInfraRoutes) applies requirePlatformAdmin
 * before mounting this, so unauthenticated requests already 401 / 403
 * before reaching the bull-board UI.
 */

import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { Router } from "express";
import type { Queue } from "bullmq";
import { getAgentPromptQueue, getDlqQueue, getRunQueue } from "../../queue/queues";

export function createBullBoardRouter(): Router {
  const router = Router();

  const queues = [getRunQueue(), getDlqQueue(), getAgentPromptQueue()].filter(
    (q): q is Queue => q !== null,
  );

  if (queues.length === 0) {
    // Redis not configured (dev without REDIS_URL). Return a router that
    // serves a minimal stub so the iframe doesn't 404 — the Compute page's
    // status pills still show the Redis state.
    router.get("/", (_req, res) => {
      res
        .status(503)
        .set("Content-Type", "text/html")
        .send(
          `<html><body style="font-family: system-ui; padding: 2rem;">` +
            `<h2>Queue dashboard unavailable</h2>` +
            `<p>Redis is not configured for this environment, so there are no queues to inspect.</p>` +
            `</body></html>`,
        );
    });
    return router;
  }

  const serverAdapter = new ExpressAdapter();
  // PR #2 ships read-only; flipped to false in PR #6 when mutation routes
  // land alongside our custom queue inspector.
  createBullBoard({
    queues: queues.map((q) => new BullMQAdapter(q, { readOnlyMode: true, allowRetries: false })),
    serverAdapter,
  });

  // bull-board's ExpressAdapter expects a base path to know where its assets
  // live. The parent mount is /api/admin-console/infra/queues/_ui — set it
  // here so internal links resolve.
  serverAdapter.setBasePath("/api/admin-console/infra/queues/_ui");
  router.use("/", serverAdapter.getRouter());
  return router;
}
