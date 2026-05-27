import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (cached) return cached;
  const url = String(import.meta.env.VITE_SUPABASE_URL ?? "").trim();
  const key = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  if (!url || !key) {
    throw new Error(
      "Admin app missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY — staff sign-in cannot proceed.",
    );
  }
  cached = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: "autoflow-admin-supabase-auth",
    },
  });
  return cached;
}

/** Returns the current session's JWT or null. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await getSupabaseClient().auth.getSession();
  return data.session?.access_token ?? null;
}
