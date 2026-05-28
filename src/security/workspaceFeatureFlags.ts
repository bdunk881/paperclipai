/**
 * Workspace feature-override reader (HEL-280, RLS-aware after HEL-298).
 *
 * The `workspace_feature_overrides` table (migration 068) is the surface
 * support uses to flip per-workspace booleans without changing the plan
 * tier. Today the write path lives in the admin console
 * (`adminConsole/productOpsRoutes.ts`) but no read helper existed — every
 * caller would have written its own SELECT. This module is the single
 * read surface so flag semantics live in one place.
 *
 * HEL-298: the table has `FORCE RLS` and the only original SELECT policy
 * was admin-only, so a normal user request silently saw zero rows. We now
 * read inside `withWorkspaceContext`, and migration 086 adds a permissive
 * SELECT policy `workspace_feature_overrides_workspace_self_read` that
 * matches `workspace_id = app_current_workspace_id()`. Writes stay
 * admin-only.
 *
 * In-memory cache: 60s TTL keyed by `${workspaceId}:${flag}`. Negative
 * results are cached too so an absent row doesn't trigger a DB hit on
 * every request. Cache invalidates on TTL only — the admin write path is
 * rare and a 60s lag is acceptable. There is no cross-process
 * invalidation; if that becomes a problem, swap to Redis pub/sub.
 */

import { getPostgresPool, isPostgresPersistenceEnabled } from "../db/postgres";
import { withWorkspaceContext } from "../middleware/workspaceContext";

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

/**
 * HEL-298: `userId` is now required because the read runs inside
 * `withWorkspaceContext`, which sets both `app.current_workspace_id` and
 * `app.current_user_id`. The user GUC isn't consulted by the new
 * self-read policy, but the workspace-context transaction shape requires
 * it and existing RLS integration tests assert both are set together.
 */
export async function isWorkspaceFlagEnabled(
  workspaceId: string | null | undefined,
  userId: string | null | undefined,
  flag: string,
): Promise<boolean> {
  if (!workspaceId || !userId) return false;

  const key = cacheKey(workspaceId, flag);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.enabled;
  }

  if (!isPostgresPersistenceEnabled()) {
    cache.set(key, { enabled: false, expiresAt: Date.now() + CACHE_TTL_MS });
    return false;
  }

  const row = await withWorkspaceContext(
    getPostgresPool(),
    { workspaceId, userId },
    async (client) => {
      const result = await client.query<{ enabled: boolean; expires_at: Date | null }>(
        `SELECT enabled, expires_at
           FROM workspace_feature_overrides
          WHERE workspace_id = $1 AND flag = $2
          LIMIT 1`,
        [workspaceId, flag],
      );
      return result.rows[0] ?? null;
    },
  );

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
