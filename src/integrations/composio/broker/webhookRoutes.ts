/**
 * Composio inbound webhook route (HEL-749 / P1d).
 *
 * Mounted UNAUTHENTICATED and BEFORE express.json() (the signature over the raw
 * body is the auth boundary), mirroring the intercom / ticket-sync webhooks. The
 * SDK verifier needs the raw body, so this router parses it with express.raw.
 */

import express, { Router } from "express";
import { asyncHandler } from "../../../middleware/asyncHandler";
import { handleComposioWebhook } from "./webhookService";

export const composioWebhookRouter = Router();

// POST /api/webhooks/composio
composioWebhookRouter.post(
  "/",
  express.raw({ type: "application/json" }),
  asyncHandler(async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    const outcome = await handleComposioWebhook(rawBody, {
      id: req.header("webhook-id"),
      timestamp: req.header("webhook-timestamp"),
      signature: req.header("webhook-signature"),
    });
    res.status(outcome.status).json(outcome.body);
  }),
);
