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

  const authOptions = {
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
  };

  cachedClient = createClient(url, anonKey, { auth: authOptions });

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

export function isAuthRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  // Supabase returns both human-readable ("email rate limit exceeded") and
  // snake_case ("over_email_send_rate_limit") forms depending on path. Match
  // either.
  return normalized.includes("rate limit") || normalized.includes("rate_limit");
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
    // HEL-284: Supabase's built-in SMTP caps emails at 2/hour project-wide
    // and doesn't return Retry-After. Point users at alternatives instead
    // of leaving them stuck waiting.
    return "Too many sign-in emails sent in the last hour. Try signing in with your password or Google/GitHub, or wait a minute and try again.";
  }
  if (normalized.includes("pkce") && normalized.includes("code verifier")) {
    return "This sign-in link must be opened in the same browser where you started it. Request a new link, or sign in with email and password.";
  }
  if (normalized.includes("aal2") && normalized.includes("required")) {
    // gotrue blocks password/email changes from an aal1 recovery session when
    // MFA is enabled. The recovery page now prompts for an authenticator code,
    // so this only surfaces if that step-up didn't complete.
    return "Enter the code from your authenticator app to confirm it's you, then set your new password.";
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

/**
 * Passwordless passkey sign-up, phase 1: email a one-time code that proves the
 * user controls the inbox. Uses Supabase's email OTP (`signInWithOtp` with
 * `shouldCreateUser`), so a brand-new email provisions the account on verify
 * and an existing email simply re-authenticates (letting them add a passkey).
 * The full name rides along as user metadata, matching the password sign-up.
 *
 * NOTE: the Supabase project's email template must surface the `{{ .Token }}`
 * code (not only the magic link) for the code-entry step to work.
 */
export async function sendSignupEmailOtp(email: string, fullName?: string): Promise<void> {
  const client = requireSupabaseClient();
  const trimmedName = fullName?.trim();
  const { error } = await client.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      ...(trimmedName ? { data: { full_name: trimmedName } } : {}),
    },
  });
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Passwordless passkey sign-up, phase 2: verify the emailed code.
 *
 * Verification runs on a DETACHED client (`persistSession: false`) so it does
 * NOT install the session into the shared dashboard client. That matters: the
 * moment the shared client adopts a session, `onAuthStateChange` fires and the
 * router redirects away from `/login`, which would unmount the sign-up form
 * mid-flow and bounce the user into the MFA-enrollment onboarding before the
 * passkey ceremony finished. Instead we hand the tokens back so the caller can
 * register the passkey FIRST, then adopt the session via
 * `setSupabaseSessionFromTokens`.
 */
export async function verifySignupEmailOtp(
  email: string,
  code: string,
): Promise<StoredAuthSession> {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) {
    throw new Error("Supabase auth is not configured for this dashboard environment.");
  }
  const detached = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await detached.auth.verifyOtp({
    email,
    token: code.trim(),
    type: "email",
  });
  if (error) {
    throw new Error(error.message);
  }
  if (!data.session) {
    throw new Error("Email verification did not return a session.");
  }
  return sessionFromSupabaseSession(data.session);
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

export interface SupabaseTotpFactor {
  id: string;
  friendlyName: string | null;
}

export interface SupabaseAalStatus {
  currentLevel: string | null;
  nextLevel: string | null;
  /** Verified TOTP factors the session can use to step up to aal2. */
  totpFactors: SupabaseTotpFactor[];
}

/**
 * Reads the current Supabase AAL plus the user's verified TOTP factors.
 *
 * Used by the password-recovery flow: a recovery session lands at aal1, and
 * gotrue rejects `updateUser({ password })` with "AAL2 session is required to
 * update email or password when MFA is enabled" whenever a verified native
 * factor exists. We need to know (a) that a step-up is required and (b) which
 * TOTP factor to challenge. Only native TOTP re-mints the session JWT with
 * `aal: "aal2"` — the app-owned attestation cookie wouldn't satisfy gotrue.
 */
export async function getSupabaseAalStatus(): Promise<SupabaseAalStatus> {
  const client = requireSupabaseClient();

  const { data: aal, error: aalError } =
    await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError) {
    throw new Error(aalError.message);
  }

  let totpFactors: SupabaseTotpFactor[] = [];
  try {
    const { data: factors, error: factorsError } = await client.auth.mfa.listFactors();
    if (!factorsError && factors) {
      totpFactors = (factors.totp ?? [])
        .filter((factor) => factor.status === "verified")
        .map((factor) => ({ id: factor.id, friendlyName: factor.friendly_name ?? null }));
    }
  } catch {
    // listFactors needs a live session; if it fails we simply offer no TOTP
    // step-up and fall back to the mapped gotrue error.
  }

  return {
    currentLevel: aal?.currentLevel ?? null,
    nextLevel: aal?.nextLevel ?? null,
    totpFactors,
  };
}

/**
 * True when the session must climb to aal2 before a sensitive update
 * (password / email change) will be accepted by gotrue.
 */
export function aalStepUpRequired(status: SupabaseAalStatus): boolean {
  return status.nextLevel === "aal2" && status.currentLevel !== "aal2";
}

/**
 * Challenge + verify a TOTP factor to upgrade the *current* Supabase session
 * to aal2. Unlike the app-owned attestation cookie, this re-mints the session
 * JWT with `aal: "aal2"`, which is exactly what gotrue's `updateUser` checks.
 */
export async function verifySupabaseTotpStepUp(
  factorId: string,
  code: string,
): Promise<void> {
  const client = requireSupabaseClient();
  const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code });
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

/**
 * Adopt a Supabase session minted server-side (e.g. by the passwordless
 * passkey login flow, which verifies a WebAuthn assertion and exchanges it
 * for a real Supabase access/refresh token pair). Installs the tokens into
 * the dashboard's Supabase client — which persists them under the shared
 * storage key and starts auto-refresh — and returns the app's stored-session
 * shape so the caller can `writeStoredAuthUser`.
 */
export async function setSupabaseSessionFromTokens(
  accessToken: string,
  refreshToken: string,
): Promise<StoredAuthSession> {
  const client = requireSupabaseClient();
  const { data, error } = await client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) {
    throw new Error(error.message);
  }
  if (!data.session) {
    throw new Error("Supabase did not return a session for the provided tokens.");
  }
  return sessionFromSupabaseSession(data.session);
}

/** @internal Test-only reset for exchange deduplication state. */
export function resetSupabaseAuthExchangeStateForTests(): void {
  codeExchangePromise = null;
  cachedClient = undefined;
}
