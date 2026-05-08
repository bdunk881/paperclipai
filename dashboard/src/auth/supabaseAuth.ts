import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { StoredAuthSession } from "./authStorage";

export type SupabaseOAuthProvider = "google" | "github";

const SUPABASE_STORAGE_KEY = "autoflow-supabase-auth";

let cachedClient: SupabaseClient | null | undefined;

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
  return String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();
}

function createSessionStorageAdapter() {
  return {
    getItem(key: string) {
      if (typeof window === "undefined") {
        return null;
      }

      return window.sessionStorage.getItem(key);
    },
    setItem(key: string, value: string) {
      if (typeof window === "undefined") {
        return;
      }

      window.sessionStorage.setItem(key, value);
    },
    removeItem(key: string) {
      if (typeof window === "undefined") {
        return;
      }

      window.sessionStorage.removeItem(key);
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
      detectSessionInUrl: true,
      flowType: "pkce",
      storageKey: SUPABASE_STORAGE_KEY,
      storage: createSessionStorageAdapter(),
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

export async function getSupabaseStoredSession(): Promise<StoredAuthSession | null> {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

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
