/**
 * Mints a real Supabase session for a known user, server-side.
 *
 * The passwordless passkey login flow verifies a WebAuthn assertion and
 * resolves it to a `userId`, but the rest of the app authenticates with
 * Supabase JWTs (RLS, `req.auth`, the dashboard's Supabase client). So once
 * we trust the user we still have to hand the browser a genuine Supabase
 * access/refresh token pair.
 *
 * There is no admin API that returns a session directly, so we use the
 * supported bridge: the service-role client generates a single-use magic-link
 * `hashed_token` for the user's email, then an anon client immediately
 * `verifyOtp`s that token hash to obtain a session. The token never leaves
 * the server and is consumed in the same request, so it's never emailed or
 * exposed to the browser.
 *
 * Requires both the service-role key (to generate the link) and the anon /
 * publishable key (to verify it). Callers should gate on
 * `isSupabaseSessionMintingConfigured()` and degrade with a 503 otherwise.
 */

import { createClient } from "@supabase/supabase-js";
import {
  getSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "../adminConsole/supabaseAdminClient";

export interface MintedSupabaseSession {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds, or null if Supabase didn't return one. */
  expiresAt: number | null;
  user: { id: string; email: string | null };
}

function readUrl(): string | null {
  const url = process.env.SUPABASE_URL ?? process.env.PRODUCTION_SUPABASE_URL ?? null;
  return url && url.trim().length > 0 ? url.trim() : null;
}

function readAnonKey(): string | null {
  const k = process.env.SUPABASE_PUBLISHABLE_KEY ?? null;
  return k && k.trim().length > 0 ? k.trim() : null;
}

export function isSupabaseSessionMintingConfigured(): boolean {
  return isSupabaseAdminConfigured() && readUrl() !== null && readAnonKey() !== null;
}

/**
 * Builds a Supabase session for `userId`. Throws if the user can't be
 * resolved or any step of the bridge fails — the caller maps that to a 5xx.
 */
export async function mintSupabaseSessionForUser(
  userId: string,
): Promise<MintedSupabaseSession> {
  const url = readUrl();
  const anonKey = readAnonKey();
  if (!url || !anonKey) {
    throw new Error("Supabase session minting not configured (missing URL or publishable key).");
  }

  const admin = getSupabaseAdminClient();
  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(userId);
  if (userErr || !userData?.user?.email) {
    throw new Error(`Could not resolve email for user ${userId}: ${userErr?.message ?? "no email"}`);
  }
  const email = userData.user.email;

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = linkData?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    throw new Error(`Supabase generateLink failed: ${linkErr?.message ?? "no hashed_token"}`);
  }

  // Anon client: verifyOtp is a public auth endpoint, not an admin one.
  // persistSession:false so this throwaway client never touches storage.
  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verifyData, error: verifyErr } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  const session = verifyData?.session;
  if (verifyErr || !session) {
    throw new Error(`Supabase verifyOtp failed: ${verifyErr?.message ?? "no session"}`);
  }

  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? null,
    user: { id: userData.user.id, email },
  };
}
