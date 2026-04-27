import { parseJsonColumn, serializeJson } from "../db/json";
import { isPostgresConfigured, queryPostgres } from "../db/postgres";
import type { SocialAuthProvider } from "./appAuthTokens";

export type SocialAuthProfileInput = {
  provider: SocialAuthProvider;
  providerSubject: string;
  email?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  rawProfile: Record<string, unknown>;
};

export type LocalAuthUser = {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

type LocalAuthUserRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

type LocalIdentityRow = LocalAuthUserRow & {
  provider_profile: Record<string, unknown> | string | null;
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
    avatarUrl: row.avatar_url,
  };
}

async function findUserByIdentity(
  profile: SocialAuthProfileInput
): Promise<LocalAuthUser | null> {
  const result = await queryPostgres<LocalIdentityRow>(
    `SELECT
        u.id,
        u.email,
        u.display_name,
        u.avatar_url,
        i.provider_profile
      FROM auth_user_identities i
      INNER JOIN auth_users u ON u.id = i.user_id
      WHERE i.provider = $1 AND i.provider_subject = $2
      LIMIT 1`,
    [profile.provider, profile.providerSubject]
  );

  return result.rows[0] ? mapLocalAuthUser(result.rows[0]) : null;
}

async function findUserByEmail(emailNormalized: string): Promise<LocalAuthUser | null> {
  const result = await queryPostgres<LocalAuthUserRow>(
    `SELECT id, email, display_name, avatar_url
      FROM auth_users
      WHERE email_normalized = $1
      LIMIT 1`,
    [emailNormalized]
  );

  return result.rows[0] ? mapLocalAuthUser(result.rows[0]) : null;
}

async function insertUser(profile: SocialAuthProfileInput, emailNormalized: string | null): Promise<LocalAuthUser> {
  const result = await queryPostgres<LocalAuthUserRow>(
    `INSERT INTO auth_users (
        email,
        email_normalized,
        display_name,
        avatar_url
      ) VALUES ($1, $2, $3, $4)
      RETURNING id, email, display_name, avatar_url`,
    [
      profile.email?.trim() || null,
      emailNormalized,
      profile.displayName?.trim() || null,
      profile.avatarUrl?.trim() || null,
    ]
  );

  return mapLocalAuthUser(result.rows[0]);
}

async function updateUser(userId: string, profile: SocialAuthProfileInput, emailNormalized: string | null): Promise<LocalAuthUser> {
  const result = await queryPostgres<LocalAuthUserRow>(
    `UPDATE auth_users
      SET
        email = COALESCE($2, email),
        email_normalized = COALESCE($3, email_normalized),
        display_name = COALESCE($4, display_name),
        avatar_url = COALESCE($5, avatar_url),
        updated_at = now(),
        last_login_at = now()
      WHERE id = $1
      RETURNING id, email, display_name, avatar_url`,
    [
      userId,
      profile.email?.trim() || null,
      emailNormalized,
      profile.displayName?.trim() || null,
      profile.avatarUrl?.trim() || null,
    ]
  );

  return mapLocalAuthUser(result.rows[0]);
}

async function upsertIdentity(userId: string, profile: SocialAuthProfileInput): Promise<void> {
  await queryPostgres(
    `INSERT INTO auth_user_identities (
        provider,
        provider_subject,
        user_id,
        provider_email,
        provider_profile
      ) VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (provider, provider_subject) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        provider_email = EXCLUDED.provider_email,
        provider_profile = EXCLUDED.provider_profile,
        updated_at = now()`,
    [
      profile.provider,
      profile.providerSubject,
      userId,
      profile.email?.trim() || null,
      serializeJson(profile.rawProfile),
    ]
  );
}

export async function upsertLocalUserFromSocialProfile(
  profile: SocialAuthProfileInput
): Promise<LocalAuthUser> {
  if (!isPostgresConfigured()) {
    throw new Error("Social auth requires PostgreSQL persistence");
  }

  const providerSubject = profile.providerSubject.trim();
  if (!providerSubject) {
    throw new Error("Social auth profile is missing a provider subject");
  }

  const normalizedProfile = {
    ...profile,
    providerSubject,
  };
  const emailNormalized = normalizeEmail(profile.email);

  const existingByIdentity = await findUserByIdentity(normalizedProfile);
  const existingUser =
    existingByIdentity ?? (emailNormalized ? await findUserByEmail(emailNormalized) : null);

  const user = existingUser
    ? await updateUser(existingUser.id, normalizedProfile, emailNormalized)
    : await insertUser(normalizedProfile, emailNormalized);

  await upsertIdentity(user.id, normalizedProfile);
  return user;
}

export function parseStoredProviderProfile(value: unknown): Record<string, unknown> {
  return parseJsonColumn<Record<string, unknown>>(value, {});
}
