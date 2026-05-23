import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import {
  EmailAuthSessionRecord,
  EmailAuthSessionUser,
  firstMetadataString,
} from "./emailAuthConfig";

let cachedClient: SupabaseClient | null | undefined;

export function getSupabaseServiceClient(): SupabaseClient | null {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !serviceKey) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedClient;
}

export function resetSupabaseServiceClientForTests(): void {
  cachedClient = undefined;
}

export function sessionRecordFromSupabaseSession(session: Session): EmailAuthSessionRecord {
  const metadata = session.user.user_metadata ?? {};
  const appMetadata = session.user.app_metadata ?? {};
  const email = session.user.email ?? firstMetadataString(metadata.email) ?? "unknown@autoflow.local";
  const name =
    firstMetadataString(metadata.full_name) ??
    firstMetadataString(metadata.name) ??
    firstMetadataString(metadata.display_name) ??
    email;

  const user: EmailAuthSessionUser = {
    id: session.user.id,
    email,
    name,
    tenantId:
      firstMetadataString(appMetadata.tenant_id) ?? firstMetadataString(metadata.tenant_id),
  };

  return {
    user,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: (session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000,
  };
}
