/**
 * Shared webhook replay guard (HEL-459 / B2).
 *
 * Connector webhook handlers reject duplicate signed deliveries by remembering
 * a per-request key (`${timestamp}:${signature}` etc.) for the provider's
 * replay window. That dedupe was a process-local `Set`/`Map` in each connector,
 * so on the 2-machine prod fleet it wasn't shared (a replay against the *other*
 * instance, or after a deploy, slipped through) — the replay check provided no
 * real protection under horizontal scaling.
 *
 * `isWebhookReplay` records the key in Redis with `SET key NX EX <window>` —
 * atomic, shared across instances, and self-expiring — and returns whether the
 * key was already present (i.e. a replay). In dev/test (no Redis) it falls back
 * to an in-memory map with TTL pruning; on a Redis error it degrades to the
 * same in-memory path so a Redis blip never blocks legitimate webhooks.
 */

import { getRedisClient } from "../../queue/redisClient";

// allowlist: dev/test + Redis-error degrade fallback (Redis is the cross-instance source of truth in prod); key -> expiry epoch ms.
const memoryReplay = new Map<string, number>();

function pruneMemory(now: number): void {
  for (const [key, expiry] of memoryReplay) {
    if (expiry <= now) memoryReplay.delete(key);
  }
}

function recordInMemory(fullKey: string, windowSeconds: number): boolean {
  const now = Date.now();
  pruneMemory(now);
  if (memoryReplay.has(fullKey)) return true;
  memoryReplay.set(fullKey, now + windowSeconds * 1000);
  return false;
}

/**
 * Returns `true` if `key` was already seen within `windowSeconds` (a replay);
 * otherwise atomically marks it seen and returns `false`. `namespace` scopes
 * the key per connector (e.g. "slack").
 */
export async function isWebhookReplay(
  namespace: string,
  key: string,
  windowSeconds: number,
): Promise<boolean> {
  const fullKey = `webhook-replay:${namespace}:${key}`;
  const redis = getRedisClient();
  if (redis) {
    try {
      // NX → only sets if absent; returns "OK" when set, null when it already
      // existed (→ replay). EX self-expires at the end of the window.
      const result = await redis.set(fullKey, "1", "EX", windowSeconds, "NX");
      return result === null;
    } catch {
      // Degrade to the in-memory path on a Redis error.
    }
  }
  return recordInMemory(fullKey, windowSeconds);
}

/** Test-only — clears the in-memory fallback. */
export function clearWebhookReplayGuardForTests(): void {
  memoryReplay.clear();
}
