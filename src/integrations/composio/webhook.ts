import { createHash, createHmac, timingSafeEqual } from "crypto";
import { ConnectorError } from "./types";

const DEFAULT_TOLERANCE_SECONDS = 300;
const replayCache = new Map<string, number>();

function toleranceSeconds(): number {
  const raw = process.env.COMPOSIO_WEBHOOK_TOLERANCE_SECONDS;
  const parsed = raw ? Number(raw) : DEFAULT_TOLERANCE_SECONDS;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_TOLERANCE_SECONDS;
}

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

export function verifyComposioWebhook(params: {
  rawBody: Buffer;
  signatureHeader?: string;
  webhookIdHeader?: string;
  webhookTimestampHeader?: string;
  signingSecret: string;
}): void {
  const signatureHeader = params.signatureHeader?.trim();
  const webhookId = params.webhookIdHeader?.trim();
  const webhookTimestamp = params.webhookTimestampHeader?.trim();

  if (!signatureHeader || !webhookId || !webhookTimestamp) {
    throw new ConnectorError("auth", "Missing Composio webhook verification headers", 401);
  }

  const timestampMs = Number(webhookTimestamp) * 1000;
  if (!Number.isFinite(timestampMs)) {
    throw new ConnectorError("schema", "Invalid Composio webhook timestamp", 400);
  }

  const toleranceMs = toleranceSeconds() * 1000;
  const nowMs = Date.now();
  if (toleranceMs > 0 && Math.abs(nowMs - timestampMs) > toleranceMs) {
    throw new ConnectorError("auth", "Composio webhook timestamp outside tolerance", 401);
  }

  cleanupReplayCache(nowMs);
  const replayKey = createHash("sha256")
    .update(webhookId)
    .update(".")
    .update(webhookTimestamp)
    .update(".")
    .update(params.rawBody)
    .digest("hex");

  if (replayCache.has(replayKey)) {
    throw new ConnectorError("auth", "Composio webhook replay detected", 409);
  }

  const signingString = `${webhookId}.${webhookTimestamp}.${params.rawBody.toString("utf8")}`;
  const expected = createHmac("sha256", params.signingSecret)
    .update(signingString)
    .digest("base64");
  const received = signatureHeader.split(",")[1] ?? signatureHeader;

  if (!signaturesEqual(expected, received)) {
    throw new ConnectorError("auth", "Invalid Composio webhook signature", 401);
  }

  replayCache.set(replayKey, nowMs + Math.max(toleranceMs, DEFAULT_TOLERANCE_SECONDS * 1000));
}

export function clearComposioWebhookReplayCache(): void {
  replayCache.clear();
}
