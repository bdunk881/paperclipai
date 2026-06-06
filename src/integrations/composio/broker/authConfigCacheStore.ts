/**
 * authConfigCacheStore — persistence for `composio_auth_configs` (HEL-739 / P1a).
 *
 * The SHARED, project-wide toolkit -> auth-config (ac_) cache. With one shared
 * Composio project (HEL-720) the mapping is identical for every workspace and
 * holds no secrets (managed auth: Composio holds the credentials), so this store
 * is intentionally NOT workspace-scoped — it runs against the pool directly
 * (the migration-108 policy is global `USING (true)`).
 *
 * Dual-path like the rest of the broker:
 *  - Postgres (canonical): plain pooled queries (no workspace context).
 *  - In-memory (dev/test): a process-local Map, gated by `inMemoryAllowed()`.
 */

import { isPostgresConfigured, inMemoryAllowed, queryPostgres } from "../../../db/postgres";

export interface ComposioAuthConfigCacheRow {
  toolkit: string;
  authConfigId: string;
  isComposioManaged: boolean;
  createdAt: string;
}

// Process-local mirror of the SHARED, project-wide composio_auth_configs table.
// allowlist: dev/test-only fallback when Postgres is unconfigured (HEL-739).
const memCache = new Map<string, ComposioAuthConfigCacheRow>();

function backend(): "pg" | "memory" {
  if (isPostgresConfigured()) return "pg";
  if (inMemoryAllowed()) return "memory";
  throw new Error("DATABASE_URL is required for composio_auth_configs outside development/test");
}

interface AuthConfigCacheDbRow {
  toolkit: string;
  auth_config_id: string;
  is_composio_managed: boolean;
  created_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function rowFromDb(r: AuthConfigCacheDbRow): ComposioAuthConfigCacheRow {
  return {
    toolkit: r.toolkit,
    authConfigId: r.auth_config_id,
    isComposioManaged: r.is_composio_managed,
    createdAt: toIso(r.created_at),
  };
}

export const authConfigCacheStore = {
  /** The cached auth config for a toolkit slug, or null. */
  async get(toolkit: string): Promise<ComposioAuthConfigCacheRow | null> {
    if (backend() === "pg") {
      const res = await queryPostgres<AuthConfigCacheDbRow>(
        `SELECT * FROM composio_auth_configs WHERE toolkit = $1`,
        [toolkit],
      );
      return res.rows[0] ? rowFromDb(res.rows[0]) : null;
    }
    return memCache.get(toolkit) ?? null;
  },

  /**
   * Cache a toolkit's auth config. First-writer-wins (ON CONFLICT DO NOTHING) so
   * a fleet race on first-connect settles on a single ac_ for the toolkit.
   */
  async put(toolkit: string, authConfigId: string, isComposioManaged = true): Promise<void> {
    if (backend() === "pg") {
      await queryPostgres(
        `INSERT INTO composio_auth_configs (toolkit, auth_config_id, is_composio_managed)
         VALUES ($1, $2, $3)
         ON CONFLICT (toolkit) DO NOTHING`,
        [toolkit, authConfigId, isComposioManaged],
      );
      return;
    }
    if (!memCache.has(toolkit)) {
      memCache.set(toolkit, {
        toolkit,
        authConfigId,
        isComposioManaged,
        createdAt: new Date().toISOString(),
      });
    }
  },

  /** Test-only: clear the in-memory backend. */
  __resetForTests(): void {
    memCache.clear();
  },
};

export type AuthConfigCacheStore = typeof authConfigCacheStore;
