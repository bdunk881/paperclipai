import { isPostgresConfigured, queryPostgres } from "../db/postgres";
import type { SocialAuthProvider } from "./appAuthTokens";

export type SocialAuthProfileInput = {
  provider: SocialAuthProvider;
  providerSubject: string;
  email?: string | null;
  displayName?: string | null;
};

export type LocalAuthUser = {
  id: string;
  email: string | null;
  displayName: string | null;
};

type LocalAuthUserRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  last_login_at?: string;
};

function normalizeEmail(email?: string | null): string | null {
  if (typeof email !== "string") {
    return null;
  }

  const normalized = email.trim().toLowerCase();
  return normalized || null;
}

function mapLocalAuthUser(row: LocalAuthUserRow): LocalAuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
  };
}

export async function upsertLocalUserFromSocialProfile(
  profile: SocialAuthProfileInput
): Promise<LocalAuthUser> {
  if (!isPostgresConfigured()) {
    throw new Error("Social auth requires PostgreSQL persistence");
  }

  const providerUserId = profile.providerSubject.trim();
  if (!providerUserId) {
    throw new Error("Social auth profile is missing a provider subject");
  }

  const email = normalizeEmail(profile.email);
  if (!email) {
    throw new Error("Social auth profile is missing an email address");
  }

  const result = await queryPostgres<LocalAuthUserRow>(
    `INSERT INTO social_auth_users (
        email,
        display_name,
        provider,
        provider_user_id
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT (provider, provider_user_id) DO UPDATE SET
        email = EXCLUDED.email,
        display_name = COALESCE(EXCLUDED.display_name, social_auth_users.display_name),
        last_login_at = now()
      RETURNING id, email, display_name, last_login_at`,
    [email, profile.displayName?.trim() || null, profile.provider, providerUserId]
  );

  return mapLocalAuthUser(result.rows[0]);
}
