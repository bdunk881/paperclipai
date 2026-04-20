import { createHmac, timingSafeEqual } from "crypto";
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

export function verifyShopifyWebhook(params: {
  rawBody: Buffer;
  hmacHeader?: string;
  webhookIdHeader?: string;
  signingSecret: string;
}): void {
  const hmacHeader = params.hmacHeader;
  if (!hmacHeader) {
    throw new ConnectorError("auth", "Missing Shopify webhook signature header", 401);
  }

  const nowMs = Date.now();
  cleanupReplayCache(nowMs);

  const replayKey = params.webhookIdHeader?.trim();
  if (replayKey) {
    if (replayCache.has(replayKey)) {
      throw new ConnectorError("auth", "Shopify webhook replay detected", 409);
    }
  }

  const digestBase64 = createHmac("sha256", params.signingSecret)
    .update(params.rawBody)
    .digest("base64");

  const a = Buffer.from(hmacHeader, "utf8");
  const b = Buffer.from(digestBase64, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ConnectorError("auth", "Invalid Shopify webhook signature", 401);
  }

  if (replayKey) {
    replayCache.set(replayKey, nowMs + FIVE_MINUTES_MS);
  }
}

export function clearShopifyWebhookReplayCache(): void {
  replayCache.clear();
}
