/**
 * Redis read-through cache for workspace-scoped GET surfaces.
 *
 * Uses the existing Upstash TCP client (BullMQ / presence). Falls through to
 * the loader on miss, Redis down, or in-memory dev mode — never fails the
 * request because cache is unavailable.
 */

import { getRedisClient, isRedisConfigured } from "../queue/redisClient";

const KEY_PREFIX = "v1:ws:";

export function isReadCacheEnabled(): boolean {
  if (process.env.AUTOFLOW_ALLOW_INMEMORY === "true") {
    return false;
  }
  if (process.env.NODE_ENV === "test") {
    return false;
  }
  return isRedisConfigured();
}

function cacheKey(workspaceId: string, surface: string): string {
  return `${KEY_PREFIX}${workspaceId}:${surface}`;
}

export async function cachedWorkspaceRead<T>(
  workspaceId: string,
  surface: string,
  ttlSec: number,
  loader: () => Promise<T>,
): Promise<T> {
  if (!isReadCacheEnabled()) {
    return loader();
  }

  const client = getRedisClient();
  if (!client) {
    return loader();
  }

  const key = cacheKey(workspaceId, surface);

  try {
    const hit = await client.get(key);
    if (hit) {
      return JSON.parse(hit) as T;
    }
  } catch (err) {
    console.warn(`[readCache] get failed for ${surface}: ${(err as Error).message}`);
  }

  const value = await loader();

  try {
    await client.setex(key, ttlSec, JSON.stringify(value));
  } catch (err) {
    console.warn(`[readCache] set failed for ${surface}: ${(err as Error).message}`);
  }

  return value;
}

const SURFACE_ALIASES: Record<string, string[]> = {
  home: ["home", "agents", "missions", "approvals", "budgets"],
  agents: ["agents", "home"],
  missions: ["missions", "home"],
  approvals: ["approvals", "home"],
  budgets: ["budgets", "home", "org-graph"],
  "org-graph": ["org-graph"],
  entitlements: ["entitlements"],
};

export async function invalidateWorkspaceCache(
  workspaceId: string,
  surfaces: string[],
): Promise<void> {
  if (!isReadCacheEnabled()) {
    return;
  }

  const client = getRedisClient();
  if (!client) {
    return;
  }

  const keys = new Set<string>();
  for (const surface of surfaces) {
    keys.add(cacheKey(workspaceId, surface));
    for (const alias of SURFACE_ALIASES[surface] ?? []) {
      keys.add(cacheKey(workspaceId, alias));
    }
  }

  try {
    if (keys.size > 0) {
      await client.del(...Array.from(keys));
    }
  } catch (err) {
    console.warn(
      `[readCache] invalidate failed for workspace=${workspaceId}: ${(err as Error).message}`,
    );
  }
}
