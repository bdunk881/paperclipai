/**
 * authConfigProvisioning — lazy, shared managed auth-config provisioning (HEL-739 / P1a).
 *
 * Resolves the project-wide managed auth config (ac_) for a toolkit, creating it
 * on first use. With one shared Composio project (HEL-720) the ac_ is reused
 * across all workspaces, so it is cached without a workspace scope.
 *
 * Resolution order (idempotent across restarts and fleet instances):
 *   1. DB cache (composio_auth_configs).
 *   2. Composio `authConfigs.list` — reuse an existing managed, ENABLED config.
 *   3. Composio `authConfigs.create({ type: "use_composio_managed_auth" })`.
 *
 * Gated behind `isComposioEnabled()` — callers get a clear error if the broker
 * is not configured rather than a half-working path.
 */

import { isComposioEnabled } from "./config";
import { getComposioBroker } from "./client";
import { authConfigCacheStore } from "./authConfigCacheStore";

/** Normalize a toolkit identifier to its canonical lowercase slug. */
export function normalizeToolkitSlug(toolkit: string): string {
  const slug = toolkit?.trim().toLowerCase();
  if (!slug) {
    throw new Error("provisionManagedAuthConfig requires a non-empty toolkit");
  }
  return slug;
}

/**
 * Provision (or reuse) the shared managed auth config for a toolkit, returning
 * its `ac_` id. Lazy + cached; safe to call on every connect.
 */
export async function provisionManagedAuthConfig(toolkit: string): Promise<string> {
  const slug = normalizeToolkitSlug(toolkit);

  const cached = await authConfigCacheStore.get(slug);
  if (cached) {
    return cached.authConfigId;
  }

  if (!isComposioEnabled()) {
    throw new Error(
      "Composio is not enabled (set COMPOSIO_ENABLED=true and COMPOSIO_API_KEY) — cannot provision an auth config.",
    );
  }

  const composio = await getComposioBroker();

  // Reuse an existing managed + ENABLED auth config if one already exists for the
  // toolkit (avoids duplicate configs when the cache is cold / a peer raced us).
  let authConfigId: string | undefined;
  try {
    const existing = await composio.authConfigs.list({
      toolkit: slug,
      isComposioManaged: true,
      limit: 1,
    });
    authConfigId = existing?.items?.find((item) => item.status === "ENABLED")?.id;
  } catch {
    // list is an optimization; fall through to create on any failure.
  }

  if (!authConfigId) {
    const created = await composio.authConfigs.create(slug, {
      type: "use_composio_managed_auth",
    });
    authConfigId = created.id;
  }

  await authConfigCacheStore.put(slug, authConfigId, true);
  return authConfigId;
}

/** Test-only: clear the provisioning cache. */
export function resetAuthConfigProvisioningForTests(): void {
  authConfigCacheStore.__resetForTests();
}
