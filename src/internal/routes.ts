/**
 * Internal API routes — reachable only by the Cloudflare Worker
 * (cf-worker/) via the requireCfWorker middleware, NOT by end users.
 *
 * Mount target: app.use("/api/internal", requireCfWorker, internalRouter)
 *
 * Currently exposes a single `/__health` endpoint as a smoke target for
 * the worker→server JWT path. HEL-291+ adds real call sites (rate
 * limiter event ingestion, webhook idempotency replay, etc.).
 */
import express from "express";
import { type CfWorkerRequest } from "../middleware/requireCfWorker";

const router = express.Router();

router.get("/__health", (req, res) => {
  const claims = (req as CfWorkerRequest).cfWorker;
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    cfWorker: claims ? { sub: claims.sub, iss: claims.iss, aud: claims.aud } : null,
  });
});

export default router;
