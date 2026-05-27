/**
 * Service-role Supabase client for privileged admin-console operations.
 *
 * The key (`SUPABASE_SERVICE_ROLE_KEY`) bypasses RLS and grants
 * supabase.auth.admin.* access — never expose it to a browser. This module is
 * the ONLY place in the codebase that should reference the env var.
 *
 * The client is intentionally lazy: not every deployment has Supabase wired
 * up, and unit tests should be able to import the rest of the admin-console
 * module without a key in scope.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

function readUrl(): string | null {
  const url = process.env.SUPABASE_URL ?? process.env.PRODUCTION_SUPABASE_URL ?? null;
  return url && url.trim().length > 0 ? url.trim() : null;
}

function readServiceRoleKey(): string | null {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
  return k && k.trim().length > 0 ? k.trim() : null;
}

export function isSupabaseAdminConfigured(): boolean {
  return readUrl() !== null && readServiceRoleKey() !== null;
}

/**
 * Returns the service-role client. Throws if not configured — callers should
 * check `isSupabaseAdminConfigured()` first if the route is allowed to
 * degrade gracefully.
 */
export function getSupabaseAdminClient(): SupabaseClient {
  if (cached !== undefined) {
    if (cached === null) {
      throw new Error("Supabase service-role client not configured (missing SUPABASE_SERVICE_ROLE_KEY).");
    }
    return cached;
  }

  const url = readUrl();
  const key = readServiceRoleKey();
  if (!url || !key) {
    cached = null;
    throw new Error("Supabase service-role client not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).");
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Test-only — wipes the cache so tests can re-evaluate env vars. */
export function __resetSupabaseAdminClientForTests(): void {
  cached = undefined;
}
