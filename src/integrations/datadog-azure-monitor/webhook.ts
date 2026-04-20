import { createHmac, timingSafeEqual } from "crypto";
import { ConnectorError, MonitoringProvider } from "./types";

const FIVE_MINUTES_MS = 60 * 5 * 1000;
const replayCache = new Map<string, number>();

function cleanupReplayCache(nowMs: number): void {
  for (const [key, expiry] of replayCache.entries()) {
    if (expiry <= nowMs) {
      replayCache.delete(key);
    }
  }
}

function safeEq(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function sign(body: Buffer, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifyMonitoringWebhook(params: {
  provider: MonitoringProvider;
  rawBody: Buffer;
  signatureHeader?: string;
  deliveryIdHeader?: string;
  signingSecret: string;
}): void {
  const nowMs = Date.now();
  cleanupReplayCache(nowMs);

  if (!params.signingSecret.trim()) {
    throw new ConnectorError("auth", "Missing webhook signing secret", 503);
  }

  if (!params.signatureHeader?.trim()) {
    throw new ConnectorError("auth", `${params.provider} webhook signature is missing`, 401);
  }

  const expected = sign(params.rawBody, params.signingSecret);
  const provided = params.signatureHeader.replace(/^sha256=/i, "").trim();
  if (!safeEq(provided, expected)) {
    throw new ConnectorError("auth", `${params.provider} webhook signature is invalid`, 401);
  }

  const replayKey = params.deliveryIdHeader?.trim();
  if (!replayKey) {
    return;
  }

  if (replayCache.has(replayKey)) {
    throw new ConnectorError("auth", `${params.provider} webhook replay detected`, 409);
  }

  replayCache.set(replayKey, nowMs + FIVE_MINUTES_MS);
}

export function clearMonitoringWebhookReplayCache(): void {
  replayCache.clear();
}
