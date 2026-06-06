/**
 * Composio broker configuration (HEL-721 / project HEL-720).
 *
 * AutoFlow uses Composio as a BACKEND BROKER, not a per-user connector: ONE
 * shared, AutoFlow-owned Composio project (a single `COMPOSIO_API_KEY`), with
 * tenancy scoped by workspace. This replaces the old per-user
 * `src/integrations/composio` connector (removed in the PR-B follow-up).
 *
 * The whole broker path is gated behind `COMPOSIO_ENABLED` *and* the presence
 * of `COMPOSIO_API_KEY`. Until both are set the broker is inert and callers get
 * a clear, honest error rather than a half-working path (cf. the
 * OPENCODE_ZEN_API_KEY gate pattern).
 */

/** True only when the broker is both flag-enabled and has a key to use. */
export function isComposioEnabled(): boolean {
  return process.env.COMPOSIO_ENABLED === "true" && Boolean(process.env.COMPOSIO_API_KEY?.trim());
}

/** The shared project API key, or throw — callers should gate on isComposioEnabled() first. */
export function composioApiKeyOrThrow(): string {
  const key = process.env.COMPOSIO_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "COMPOSIO_API_KEY is not set — the Composio broker is unavailable. " +
        "Set it (Fly/Infisical) and COMPOSIO_ENABLED=true to activate the broker.",
    );
  }
  return key;
}

/** Optional override of the Composio API base (defaults to the hosted backend). */
export function composioApiBaseUrl(): string | undefined {
  const base = process.env.COMPOSIO_API_BASE_URL?.trim();
  return base ? base.replace(/\/+$/, "") : undefined;
}

/**
 * The Composio `userId` AutoFlow scopes connected accounts + tool executions +
 * triggers by. Decision (HEL-720): ONE shared project, tenancy by workspace →
 * `userId = workspaceId`. Prefixed `ws_` so a Composio user_id is never
 * ambiguous and is obviously an AutoFlow workspace.
 *
 * This is the single tenancy seam of the shared-project model: every broker
 * call MUST derive its userId here from a verified workspaceId, and callers
 * must never pass a raw, cross-workspace identifier.
 */
export function composioUserId(workspaceId: string): string {
  const ws = workspaceId?.trim();
  if (!ws) {
    throw new Error("composioUserId requires a non-empty workspaceId (tenancy guard)");
  }
  return `ws_${ws}`;
}

/** Inverse of composioUserId — extract the workspaceId from a Composio userId, or null. */
export function workspaceIdFromComposioUserId(userId: string): string | null {
  const trimmed = userId?.trim();
  if (!trimmed || !trimmed.startsWith("ws_")) {
    return null;
  }
  const ws = trimmed.slice("ws_".length);
  return ws ? ws : null;
}

let warned = false;

/**
 * Boot-time warnings when the broker is enabled but misconfigured, so a misconfig
 * is visible in logs instead of failing silently at first use. Idempotent (fires
 * at most once per process).
 *
 * Two classes of misconfig:
 *  1. Flag on but no API key → the broker is inert.
 *  2. Deployed (NODE_ENV=production, i.e. on Fly) but the public-origin env vars
 *     are unset → oauthRoutes falls back to http://localhost:5173 (dashboard
 *     redirect) and the request host (callbackUrl), so every completed OAuth
 *     connection bounces the user to localhost (HEL-750). Local dev keeps the
 *     localhost fallback, which is correct there, so this only warns when
 *     deployed.
 */
export function warnIfComposioUnconfigured(log: (msg: string) => void = console.warn): void {
  if (warned || process.env.COMPOSIO_ENABLED !== "true") {
    return;
  }
  warned = true;

  if (!process.env.COMPOSIO_API_KEY?.trim()) {
    log(
      "[composio] COMPOSIO_ENABLED=true but COMPOSIO_API_KEY is unset — the Composio broker is inert until the key is provided.",
    );
  }

  if (process.env.NODE_ENV === "production") {
    if (!process.env.DASHBOARD_APP_URL?.trim()) {
      log(
        "[composio] DASHBOARD_APP_URL is unset on a deployed environment — completed OAuth connections will redirect to http://localhost:5173. Set it to the dashboard origin (e.g. https://dev.helloautoflow.com).",
      );
    }
    if (!process.env.COMPOSIO_REDIRECT_BASE_URL?.trim()) {
      log(
        "[composio] COMPOSIO_REDIRECT_BASE_URL is unset on a deployed environment — the OAuth callbackUrl falls back to the request host. Set it to this API's public origin (e.g. https://dev-api.helloautoflow.com).",
      );
    }
  }
}

/** Test helper: reset the one-shot boot-warn latch. */
export function resetComposioConfigWarningForTests(): void {
  warned = false;
}
