import { createHmac, timingSafeEqual } from "crypto";
import express, { Request, Response, Router } from "express";
import { googleWorkspaceCredentialsStore } from "./credentialsStore";
import { logGoogleWorkspaceEvent } from "./logging";

const router = Router();
const replayCache = new Map<string, number>();
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

function clearExpiredReplayKeys(now: number): void {
  for (const [key, timestamp] of replayCache.entries()) {
    if (now - timestamp > REPLAY_WINDOW_MS) replayCache.delete(key);
  }
}

function validateSignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = signatureHeader.replace(/^sha256=/, "").trim();
  if (!received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

router.post(
  "/webhooks/:credentialId",
  express.raw({ type: "application/json" }),
  (req: Request, res: Response) => {
    const credentialId = req.params.credentialId;
    const credential = googleWorkspaceCredentialsStore.getAnyById(credentialId);
    if (!credential || !credential.webhookSigningSecret) {
      res.status(404).json({ error: `Google Workspace credential not found: ${credentialId}` });
      return;
    }

    const signatureHeader = req.headers["x-autoflow-signature"];
    if (typeof signatureHeader !== "string" || !signatureHeader.trim()) {
      logGoogleWorkspaceEvent({
        connector: "google_workspace",
        event: "error.webhook_signature_missing",
        credentialId,
        category: "auth",
      });
      res.status(401).json({ error: "Missing x-autoflow-signature header", category: "auth" });
      return;
    }

    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));

    if (!validateSignature(rawBody, signatureHeader, credential.webhookSigningSecret)) {
      logGoogleWorkspaceEvent({
        connector: "google_workspace",
        event: "error.webhook_signature_invalid",
        credentialId,
        category: "auth",
      });
      res.status(401).json({ error: "Invalid webhook signature", category: "auth" });
      return;
    }

    const deliveryIdHeader = req.headers["x-goog-message-number"];
    const deliveryId = typeof deliveryIdHeader === "string" ? deliveryIdHeader.trim() : "";
    if (!deliveryId) {
      res.status(400).json({ error: "Missing x-goog-message-number header", category: "schema" });
      return;
    }

    const now = Date.now();
    clearExpiredReplayKeys(now);
    const replayKey = `${credentialId}:${deliveryId}`;
    if (replayCache.has(replayKey)) {
      logGoogleWorkspaceEvent({
        connector: "google_workspace",
        event: "error.webhook_replay",
        credentialId,
        category: "auth",
        detail: { deliveryId },
      });
      res.status(409).json({ error: "Replay detected", category: "auth" });
      return;
    }
    replayCache.set(replayKey, now);

    const eventTypeHeader = req.headers["x-goog-resource-state"];
    const eventType = typeof eventTypeHeader === "string" && eventTypeHeader.trim()
      ? eventTypeHeader
      : "unknown";

    logGoogleWorkspaceEvent({
      connector: "google_workspace",
      event: "webhook.received",
      credentialId,
      detail: { eventType, deliveryId },
    });

    res.status(202).json({ status: "accepted", connector: "google_workspace", eventType });
  },
);

export default router;
