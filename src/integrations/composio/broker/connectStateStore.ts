/**
 * connectStateStore — short-lived OAuth handshake state for the Composio connect
 * flow (HEL-740 / P1b). Mirrors the per-connector pkceStore (HEL-44).
 *
 * The Composio OAuth callback is hit by Composio's redirect (no authenticated
 * session), so it cannot read `req.workspaceId`. At connect time (authenticated)
 * we mint a random, single-use `state` token that carries the workspace/user
 * context; the callback consumes it to recover tenancy and mark the connected
 * account ACTIVE under the correct workspace context. The token is an opaque
 * key into this server-side store — it cannot be forged or replayed.
 *
 * Process-local + short TTL by design (OAuth handshake state, not data of
 * record). Promote to Redis with the other pkce stores when those move.
 */

import { randomBytes } from "crypto";

export interface ComposioConnectStateEntry {
  state: string;
  workspaceId: string;
  userId: string;
  toolkit: string;
  expiresAt: number;
}

const EXPIRY_MS = 10 * 60 * 1000;

// allowlist: OAuth/PKCE-style handshake state with a short TTL; process-local by design (mirrors pkceStore, HEL-740).
const store = new Map<string, ComposioConnectStateEntry>();

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function cleanupExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt <= now) {
      store.delete(key);
    }
  }
}

export function createConnectState(input: {
  workspaceId: string;
  userId: string;
  toolkit: string;
}): ComposioConnectStateEntry {
  cleanupExpired();
  const state = base64Url(randomBytes(24));
  const entry: ComposioConnectStateEntry = {
    state,
    workspaceId: input.workspaceId,
    userId: input.userId,
    toolkit: input.toolkit,
    expiresAt: Date.now() + EXPIRY_MS,
  };
  store.set(state, entry);
  return entry;
}

/** Consume (single-use) the state token, returning the entry or null if missing/expired. */
export function consumeConnectState(state: string): ComposioConnectStateEntry | null {
  cleanupExpired();
  const entry = store.get(state);
  if (!entry) return null;
  store.delete(state);
  if (entry.expiresAt <= Date.now()) return null;
  return entry;
}

/** Test-only: clear all handshake state. */
export function clearConnectStateForTests(): void {
  store.clear();
}
