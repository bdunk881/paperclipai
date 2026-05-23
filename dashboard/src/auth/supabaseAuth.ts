import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { StoredAuthSession } from "./authStorage";

export type SupabaseOAuthProvider = "google" | "github";

const SUPABASE_STORAGE_KEY = "autoflow-supabase-auth";

let cachedClient: SupabaseClient | null | undefined;
let codeExchangePromise: Promise<void> | null = null;

function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const candidate = value.find((entry) => typeof entry === "string" && entry.trim());
  return typeof candidate === "string" ? candidate.trim() : undefined;
}

function getSupabaseUrl(): string {
  return String(import.meta.env.VITE_SUPABASE_URL ?? "").trim();
}

function getSupabaseAnonKey(): string {
  return String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
}

/**
 * localStorage is shared across tabs on the same origin so PKCE verifiers
 * survive magic-link / recovery emails opened in a new tab (sessionStorage
 * is per-tab and caused "PKCE code verifier not found in storage").
 */
function createLocalStorageAdapter() {
  return {
    getItem(key: string) {
      if (typeof window === "undefined") {
        return null;
      }

      return window.localStorage.getItem(key);
    },
    setItem(key: string, value: string) {
      if (typeof window === "undefined") {
        return;
      }

      window.localStorage.setItem(key, value);
    },
    removeItem(key: string) {
      if (typeof window === "undefined") {
        return;
      }

      window.localStorage.removeItem(key);
    },
  };
}

function requireSupabaseClient(): SupabaseClient {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Supabase auth is not configured for this dashboard environment.");
  }

  return client;
}

function authCallbackUrl(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return `${window.location.origin}/auth/callback`;
}

function resetPasswordUrl(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return `${window.location.origin}/reset-password`;
}

export function isSupabaseAuthConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

export function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Critical: `detectSessionInUrl: false`. With it true, supabase-js
      // auto-exchanges any `?code=` it sees at client construction time.
      // We ALSO call `exchangeCodeForSession()` explicitly from
      // `exchangeAuthCallbackCodeIfPresent()` so we can dedupe via
      // `codeExchangePromise`, surface errors deterministically, and
      // strip URL params with confidence after the exchange completes.
      // With both paths active, PKCE codes (single-use) hit a race:
      // one call succeeds, the other throws `invalid_grant` / "code
      // already used", which we surface to the user as an error on the
      // /reset-password screen — they retry the email, get a fresh
      // code, hit the same race, and loop.
      detectSessionInUrl: false,
      flowType: "pkce",
      storageKey: SUPABASE_STORAGE_KEY,
      storage: createLocalStorageAdapter(),
    },
  });

  return cachedClient;
}

export function sessionFromSupabaseSession(session: Session): StoredAuthSession {
  const metadata = session.user.user_metadata ?? {};
  const appMetadata = session.user.app_metadata ?? {};
  const email = session.user.email ?? firstString(metadata.email) ?? "unknown@autoflow.local";
  const name =
    firstString(metadata.full_name) ??
    firstString(metadata.name) ??
    firstString(metadata.display_name) ??
    email;

  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: (session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000,
    user: {
      id: session.user.id,
      email,
      name,
      tenantId: firstString(appMetadata.tenant_id) ?? firstString(metadata.tenant_id),
    },
    authProvider: "supabase",
  };
}

export function isPasswordRecoveryFlow(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.get("type") === "recovery") {
    return true;
  }

  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (hash) {
    const hashParams = new URLSearchParams(hash);
    if (hashParams.get("type") === "recovery") {
      return true;
    }
  }

  return false;
}

export function mapSupabaseAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Authentication failed. Try again.";
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return "The email or password is incorrect.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Check your inbox and confirm your email before signing in.";
  }
  if (normalized.includes("rate limit")) {
    return "Too many attempts. Wait a moment before trying again.";
  }
  if (normalized.includes("pkce") && normalized.includes("code verifier")) {
    return "This sign-in link must be opened in the same browser where you started it. Request a new link, or sign in with email and password.";
  }

  return message;
}

function readAuthCallbackError(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const errorDescription = params.get("error_description") || params.get("error");
  if (!errorDescription) {
    return null;
  }

  return decodeURIComponent(errorDescription.replace(/\+/g, " "));
}

function readAuthCallbackCode(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return new URLSearchParams(window.location.search).get("code");
}

function stripAuthCallbackParamsFromUrl(): void {
  if (typeof window === "undefined") {
    return;
  }

  const cleanUrl = `${window.location.origin}${window.location.pathname}`;
  window.history.replaceState({}, "", cleanUrl);
}

async function exchangeAuthCallbackCodeIfPresent(): Promise<void> {
  const client = getSupabaseClient();
  if (!client || typeof window === "undefined") {
    return;
  }

  const authError = readAuthCallbackError();
  if (authError) {
    throw new Error(authError);
  }

  const code = readAuthCallbackCode();
  if (!code) {
    return;
  }

  if (!codeExchangePromise) {
    codeExchangePromise = (async () => {
      // Pass the raw `?code=` value, NOT `window.location.href`. supabase-js's
      // `_exchangeCodeForSession(authCode)` ships the argument verbatim as the
      // `auth_code` field in the POST body (see auth-js GoTrueClient.js line
      // 1478) — it does NOT parse a URL. If we pass the full URL, gotrue
      // searches `auth.flow_state WHERE auth_code = '<full URL>'` and finds
      // nothing → 404 `flow_state_not_found`. The fix is one line: send
      // `code` (the UUID we already extracted above).
      const { error: exchangeError } = await client.auth.exchangeCodeForSession(code);
      if (exchangeError) {
        throw new Error(exchangeError.message);
      }
      stripAuthCallbackParamsFromUrl();
    })().finally(() => {
      codeExchangePromise = null;
    });
  }

  await codeExchangePromise;
}

/**
 * Reads the current Supabase session from local storage, OR — if the caller
 * just landed with a `?code=` param from a magic-link / OAuth / signup-confirm
 * / recovery email — exchanges that code for a fresh session first.
 */
export async function getSupabaseStoredSession(): Promise<StoredAuthSession | null> {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

  await exchangeAuthCallbackCodeIfPresent();

  const { data, error } = await client.auth.getSession();
  if (error) {
    throw new Error(error.message);
  }

  return data.session ? sessionFromSupabaseSession(data.session) : null;
}

export async function signInWithSupabasePassword(email: string, password: string): Promise<StoredAuthSession> {
  const client = requireSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data.session) {
    throw new Error("Supabase sign-in did not return a session.");
  }

  return sessionFromSupabaseSession(data.session);
}

export async function signUpWithSupabasePassword(input: {
  email: string;
  password: string;
  fullName: string;
}): Promise<StoredAuthSession | null> {
  const client = requireSupabaseClient();
  const { data, error } = await client.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: authCallbackUrl(),
      data: {
        full_name: input.fullName,
      },
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  return data.session ? sessionFromSupabaseSession(data.session) : null;
}

export async function sendSupabaseMagicLink(email: string): Promise<void> {
  const client = requireSupabaseClient();
  const { error } = await client.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: authCallbackUrl(),
    },
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function sendSupabasePasswordReset(email: string): Promise<void> {
  const client = requireSupabaseClient();
  const redirectTo = resetPasswordUrl();
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateSupabasePassword(newPassword: string): Promise<void> {
  const client = requireSupabaseClient();
  const { error } = await client.auth.updateUser({ password: newPassword });

  if (error) {
    throw new Error(error.message);
  }
}

export async function signInWithSupabaseOAuth(provider: SupabaseOAuthProvider): Promise<void> {
  const client = requireSupabaseClient();
  const { data, error } = await client.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: authCallbackUrl(),
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  if (data.url && typeof window !== "undefined") {
    window.location.assign(data.url);
  }
}

export async function signOutSupabase(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) {
    return;
  }

  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) {
    throw new Error(error.message);
  }
}

/** @internal Test-only reset for exchange deduplication state. */
export function resetSupabaseAuthExchangeStateForTests(): void {
  codeExchangePromise = null;
  cachedClient = undefined;
}
