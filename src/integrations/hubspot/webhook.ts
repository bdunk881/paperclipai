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

function decodeSignatureUri(value: string): string {
  return value
    .replace(/%3A/gi, ":")
    .replace(/%2F/gi, "/")
    .replace(/%3F/gi, "?")
    .replace(/%3D/gi, "=")
    .replace(/%26/gi, "&");
}

function signaturesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyHubSpotWebhook(params: {
  method: string;
  requestUri: string;
  rawBody: Buffer;
  signatureHeader?: string;
  timestampHeader?: string;
  clientSecret: string;
  eventIdHeader?: string;
}): void {
  const signatureHeader = params.signatureHeader?.trim();
  const timestampHeader = params.timestampHeader?.trim();

  if (!signatureHeader) {
    throw new ConnectorError("auth", "Missing HubSpot webhook signature header", 401);
  }
  if (!timestampHeader) {
    throw new ConnectorError("auth", "Missing HubSpot webhook timestamp header", 401);
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    throw new ConnectorError("auth", "Invalid HubSpot webhook timestamp header", 401);
  }

  const nowMs = Date.now();
  cleanupReplayCache(nowMs);
  if (Math.abs(nowMs - timestamp) > FIVE_MINUTES_MS) {
    throw new ConnectorError("auth", "HubSpot webhook timestamp is too old", 401);
  }

  const replayKey = params.eventIdHeader?.trim()
    || createHash("sha256").update(signatureHeader).update(params.rawBody).digest("hex");
  if (replayCache.has(replayKey)) {
    throw new ConnectorError("auth", "HubSpot webhook replay detected", 409);
  }

  const source = `${params.method.toUpperCase()}${decodeSignatureUri(params.requestUri)}${params.rawBody.toString("utf8")}${timestampHeader}`;
  const expected = createHmac("sha256", params.clientSecret).update(source, "utf8").digest("base64");
  if (!signaturesEqual(signatureHeader, expected)) {
    throw new ConnectorError("auth", "Invalid HubSpot webhook signature", 401);
  }

  replayCache.set(replayKey, nowMs + FIVE_MINUTES_MS);
}

export function clearHubSpotWebhookReplayCache(): void {
  replayCache.clear();
}
