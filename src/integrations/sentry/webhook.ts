import { createHash, createHmac, timingSafeEqual } from "crypto";
import { ConnectorError } from "./types";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const replayCache = new Map<string, number>();

function cleanupReplayCache(nowMs: number): void {
  for (const [key, expiry] of replayCache.entries()) {
    if (expiry <= nowMs) {
      replayCache.delete(key);
    }
  }
}

function signaturesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifySentryWebhook(params: {
  rawBody: Buffer;
  signatureHeader?: string;
  sentryClientSecret: string;
  hookIdHeader?: string;
  resourceHeader?: string;
  eventIdHeader?: string;
}): void {
  const signature = params.signatureHeader?.trim();
  if (!signature) {
    throw new ConnectorError("auth", "Missing Sentry webhook signature header", 401);
  }

  const nowMs = Date.now();
  cleanupReplayCache(nowMs);

  const replayKeySource = [
    params.hookIdHeader?.trim(),
    params.resourceHeader?.trim(),
    params.eventIdHeader?.trim(),
  ].filter(Boolean).join(":");
  const replayKey = replayKeySource
    || createHash("sha256").update(signature).update(params.rawBody).digest("hex");

  if (replayCache.has(replayKey)) {
    throw new ConnectorError("auth", "Sentry webhook replay detected", 409);
  }

  const digestHex = createHmac("sha256", params.sentryClientSecret)
    .update(params.rawBody)
    .digest("hex");

  if (!signaturesEqual(signature, digestHex)) {
    throw new ConnectorError("auth", "Invalid Sentry webhook signature", 401);
  }

  replayCache.set(replayKey, nowMs + FIVE_MINUTES_MS);
}

export function clearSentryWebhookReplayCache(): void {
  replayCache.clear();
}
