import { createHash, timingSafeEqual } from "crypto";
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

function safeEq(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface TeamsWebhookNotification {
  id?: string;
  subscriptionId?: string;
  clientState?: string;
  resource?: string;
  changeType?: string;
}

export function verifyTeamsWebhook(params: {
  notifications: TeamsWebhookNotification[];
  expectedClientState: string;
}): void {
  const nowMs = Date.now();
  cleanupReplayCache(nowMs);

  if (!params.expectedClientState.trim()) {
    throw new ConnectorError("auth", "Missing Teams webhook client state secret", 503);
  }

  for (const notification of params.notifications) {
    const clientState = notification.clientState;
    if (!clientState || !safeEq(clientState, params.expectedClientState)) {
      throw new ConnectorError("auth", "Invalid Teams webhook clientState", 401);
    }

    const replayKey = notification.id || notification.subscriptionId;
    if (!replayKey) continue;

    if (replayCache.has(replayKey)) {
      throw new ConnectorError("auth", "Teams webhook replay detected", 409);
    }

    replayCache.set(replayKey, nowMs + FIVE_MINUTES_MS);
  }
}

export function clearTeamsWebhookReplayCache(): void {
  replayCache.clear();
}
