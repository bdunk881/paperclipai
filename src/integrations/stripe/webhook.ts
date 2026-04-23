import { createHash, createHmac, timingSafeEqual } from "crypto";
import { ConnectorError, StripeWebhookEvent } from "./types";

const DEFAULT_TOLERANCE_SECONDS = 300;
const replayCache = new Map<string, number>();

function toleranceSeconds(): number {
  const raw = process.env.STRIPE_CONNECT_WEBHOOK_TOLERANCE_SECONDS;
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

function parseStripeSignature(header: string): { timestamp: string; signatures: string[] } {
  const parts = header.split(",").map((part) => part.trim()).filter(Boolean);
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2) ?? "";
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3))
    .filter(Boolean);

  return { timestamp, signatures };
}

export function verifyStripeWebhook(params: {
  rawBody: Buffer;
  signatureHeader?: string;
  signingSecret: string;
}): StripeWebhookEvent {
  const header = params.signatureHeader?.trim();
  if (!header) {
    throw new ConnectorError("auth", "Missing Stripe webhook signature header", 401);
  }

  const { timestamp, signatures } = parseStripeSignature(header);
  if (!timestamp || signatures.length === 0) {
    throw new ConnectorError("auth", "Malformed Stripe webhook signature header", 401);
  }

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs)) {
    throw new ConnectorError("schema", "Invalid Stripe webhook timestamp", 400);
  }

  const toleranceMs = toleranceSeconds() * 1000;
  const nowMs = Date.now();
  if (toleranceMs > 0 && Math.abs(nowMs - timestampMs) > toleranceMs) {
    throw new ConnectorError("auth", "Stripe webhook timestamp outside tolerance", 401);
  }

  const signedPayload = `${timestamp}.${params.rawBody.toString("utf8")}`;
  const expected = createHmac("sha256", params.signingSecret).update(signedPayload).digest("hex");

  const valid = signatures.some((signature) => signaturesEqual(signature, expected));
  if (!valid) {
    throw new ConnectorError("auth", "Invalid Stripe webhook signature", 401);
  }

  const parsed = JSON.parse(params.rawBody.toString("utf8")) as {
    id?: string;
    type?: string;
    created?: number;
    account?: string;
    livemode?: boolean;
  };

  if (!parsed.id || !parsed.type || typeof parsed.created !== "number") {
    throw new ConnectorError("schema", "Stripe webhook payload is missing required fields", 400);
  }

  cleanupReplayCache(nowMs);
  const replayKey = createHash("sha256")
    .update(parsed.id)
    .update(".")
    .update(timestamp)
    .update(".")
    .update(params.rawBody)
    .digest("hex");

  if (replayCache.has(replayKey)) {
    throw new ConnectorError("auth", "Stripe webhook replay detected", 409);
  }

  replayCache.set(replayKey, nowMs + Math.max(toleranceMs, DEFAULT_TOLERANCE_SECONDS * 1000));

  return {
    id: parsed.id,
    type: parsed.type,
    createdAt: new Date(parsed.created * 1000).toISOString(),
    account: parsed.account,
    livemode: parsed.livemode,
  };
}

export function clearStripeWebhookReplayCache(): void {
  replayCache.clear();
}
