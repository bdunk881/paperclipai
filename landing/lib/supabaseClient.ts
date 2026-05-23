import { createBrowserClient } from "@supabase/ssr";

export interface SupabasePublicConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  dashboardOrigin: string;
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/**
 * Reads the Supabase + dashboard env values on the server (loaders/actions).
 * Callers are expected to forward the result to the browser via useLoaderData,
 * since the landing app does not configure Vite to inline `VITE_*` env vars.
 */
export function readSupabasePublicConfig(): SupabasePublicConfig {
  return {
    supabaseUrl: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim(),
    supabasePublishableKey: (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "").trim(),
    dashboardOrigin: normalizeOrigin(
      process.env.NEXT_PUBLIC_DASHBOARD_ORIGIN ?? "https://app.helloautoflow.com"
    ),
  };
}

export function isSupabasePublicConfigured(config: SupabasePublicConfig): boolean {
  return Boolean(config.supabaseUrl && config.supabasePublishableKey);
}

export function createSupabaseBrowserClient(config: SupabasePublicConfig) {
  return createBrowserClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      flowType: "pkce",
    },
  });
}
