/**
 * Workspace feature-override reader (HEL-280).
 *
 * The `workspace_feature_overrides` table (migration 068) is the surface
 * support uses to flip per-workspace booleans without changing the plan
 * tier. Today the write path lives in the admin console
 * (`adminConsole/productOpsRoutes.ts`) but no read helper existed — every
 * caller would have written its own SELECT. This module is the single
 * read surface so flag semantics live in one place.
 *
 * In-memory cache: 60s TTL keyed by `${workspaceId}:${flag}`. Negative
 * results are cached too so an absent row doesn't trigger a DB hit on
 * every request. Cache invalidates on TTL only — the admin write path is
 * rare and a 60s lag is acceptable. There is no cross-process
 * invalidation; if that becomes a problem, swap to Redis pub/sub.
 */

import { isPostgresPersistenceEnabled, queryPostgres } from "../db/postgres";

export const REQUIRE_APP_MFA_FOR_OAUTH_USERS = "require_app_mfa_for_oauth_users";

const CACHE_TTL_MS = 60 * 1000;

interface CacheEntry {
  enabled: boolean;
  expiresAt: number;
}

// allowlist: process-local 60s TTL cache for workspace feature flags; cross-process invalidation is unnecessary at the current write velocity (admin-console toggles only)
const cache = new Map<string, CacheEntry>();

function cacheKey(workspaceId: string, flag: string): string {
  return `${workspaceId}:${flag}`;
}

export async function isWorkspaceFlagEnabled(
  workspaceId: string | null | undefined,
  flag: string,
): Promise<boolean> {
  if (!workspaceId) return false;

  const key = cacheKey(workspaceId, flag);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.enabled;
  }

  if (!isPostgresPersistenceEnabled()) {
    cache.set(key, { enabled: false, expiresAt: Date.now() + CACHE_TTL_MS });
    return false;
  }

  const result = await queryPostgres<{ enabled: boolean; expires_at: Date | null }>(
    `SELECT enabled, expires_at
       FROM workspace_feature_overrides
      WHERE workspace_id = $1 AND flag = $2
      LIMIT 1`,
    [workspaceId, flag],
  );

  const row = result.rows[0];
  const enabled = Boolean(
    row?.enabled && (row.expires_at === null || row.expires_at.getTime() > Date.now()),
  );
  cache.set(key, { enabled, expiresAt: Date.now() + CACHE_TTL_MS });
  return enabled;
}

/** Test-only — wipe the cache between runs. */
export function __resetWorkspaceFlagCacheForTests(): void {
  cache.clear();
}
