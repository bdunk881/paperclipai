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

function signaturesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function verifyPrefixedSignature(rawHeader: string, signingSecret: string, rawBody: Buffer): boolean {
  const trimmed = rawHeader.trim();
  const [prefix, provided] = trimmed.split("=");
  if (!prefix || !provided) {
    return false;
  }

  if (prefix === "sha1") {
    const digest = createHmac("sha1", signingSecret).update(rawBody).digest("hex");
    return signaturesEqual(provided, digest);
  }

  if (prefix === "sha256") {
    const digest = createHmac("sha256", signingSecret).update(rawBody).digest("hex");
    return signaturesEqual(provided, digest);
  }

  return false;
}

export function verifyIntercomWebhook(params: {
  rawBody: Buffer;
  signatureHeader?: string;
  signingSecret: string;
  deliveryIdHeader?: string;
}): void {
  const signatureHeader = params.signatureHeader;
  if (!signatureHeader || !signatureHeader.trim()) {
    throw new ConnectorError("auth", "Missing Intercom webhook signature header", 401);
  }

  const nowMs = Date.now();
  cleanupReplayCache(nowMs);

  const replayKey = params.deliveryIdHeader?.trim()
    || createHash("sha256").update(signatureHeader).update(params.rawBody).digest("hex");

  if (replayCache.has(replayKey)) {
    throw new ConnectorError("auth", "Intercom webhook replay detected", 409);
  }

  const valid = verifyPrefixedSignature(signatureHeader, params.signingSecret, params.rawBody);
  if (!valid) {
    throw new ConnectorError("auth", "Invalid Intercom webhook signature", 401);
  }

  replayCache.set(replayKey, nowMs + FIVE_MINUTES_MS);
}

export function clearIntercomWebhookReplayCache(): void {
  replayCache.clear();
}
