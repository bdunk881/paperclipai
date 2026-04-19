import { createHash, createHmac, timingSafeEqual } from "crypto";
import { ConnectorError } from "./types";

const FIVE_MINUTES_MS = 60 * 5 * 1000;
const replayCache = new Map<string, number>();

function cleanupReplayCache(nowMs: number): void {
  for (const [key, expiry] of replayCache.entries()) {
    if (expiry <= nowMs) {
      replayCache.delete(key);
    }
  }
}

function normalizeSignature(signatureHeader: string): string {
  return signatureHeader.trim().replace(/^sha256=/i, "");
}

function signaturesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyLinearWebhook(params: {
  rawBody: Buffer;
  signatureHeader?: string;
  deliveryIdHeader?: string;
  signingSecret: string;
}): void {
  const signatureHeader = params.signatureHeader;
  if (!signatureHeader || !signatureHeader.trim()) {
    throw new ConnectorError("auth", "Missing Linear webhook signature header", 401);
  }

  const nowMs = Date.now();
  cleanupReplayCache(nowMs);

  const replayKey = params.deliveryIdHeader?.trim()
    || createHash("sha256").update(signatureHeader).update(params.rawBody).digest("hex");

  if (replayCache.has(replayKey)) {
    throw new ConnectorError("auth", "Linear webhook replay detected", 409);
  }

  const digestHex = createHmac("sha256", params.signingSecret)
    .update(params.rawBody)
    .digest("hex");

  const digestBase64 = createHmac("sha256", params.signingSecret)
    .update(params.rawBody)
    .digest("base64");

  const normalized = normalizeSignature(signatureHeader);
  const valid = signaturesEqual(normalized, digestHex) || signaturesEqual(normalized, digestBase64);

  if (!valid) {
    throw new ConnectorError("auth", "Invalid Linear webhook signature", 401);
  }

  replayCache.set(replayKey, nowMs + FIVE_MINUTES_MS);
}

export function clearLinearWebhookReplayCache(): void {
  replayCache.clear();
}
