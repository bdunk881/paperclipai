/**
 * Inbound comms webhook routes (HEL-613): `POST /api/webhooks/comms/<provider>`.
 *
 * Mounted in app.ts BEFORE the global `express.json()` so each provider route
 * can read the raw body for signature verification. Postgres-gated by the
 * caller (wake_events writes need it). Deps are injectable for tests.
 *
 * HEL-361 still owns the SES route + suppression; SES bounce/complaint events
 * reach this ingest via the SES route's injected `onInboundEvent` hook (wired
 * in app.ts), not a route here — so there is no overlap.
 */

import express, { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { getPostgresPool } from "../../db/postgres";
import { createCommsInboundIngest, type CommsInboundIngest } from "./ingest";
import { normalizeTelnyxWebhook } from "./normalize";
import { verifyTelnyxSignature, type TelnyxVerifyInput } from "./telnyxSignature";

export interface CommsWebhookDeps {
  /** Inbound ingest. Default: createCommsInboundIngest({ pool: getPostgresPool() }). */
  ingest?: CommsInboundIngest;
  /** Telnyx signature check (test injection point). */
  verifyTelnyx?: (input: TelnyxVerifyInput) => boolean;
}

export function createCommsWebhookRoutes(deps: CommsWebhookDeps = {}): Router {
  const ingest = deps.ingest ?? createCommsInboundIngest({ pool: getPostgresPool() });
  const verifyTelnyx = deps.verifyTelnyx ?? ((input) => verifyTelnyxSignature(input));

  const router = Router();

  // Telnyx posts application/json; raw body needed for the Ed25519 check.
  router.post(
    "/telnyx",
    express.raw({ type: "application/json", limit: "1mb" }),
    asyncHandler(async (req, res) => {
      const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
      const verified = verifyTelnyx({
        payload: raw,
        signature: String(req.header("telnyx-signature-ed25519") ?? ""),
        timestamp: String(req.header("telnyx-timestamp") ?? ""),
      });
      if (!verified) {
        res.status(403).json({ error: "invalid telnyx signature" });
        return;
      }

      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        res.status(400).json({ error: "invalid json" });
        return;
      }

      const event = normalizeTelnyxWebhook(body);
      if (!event) {
        res.json({ ok: true, ignored: true });
        return;
      }
      const result = await ingest(event);
      res.json({ ok: true, ...result });
    }),
  );

  return router;
}
