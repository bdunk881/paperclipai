import { getPostgresPool, isPostgresConfigured } from "../db/postgres";
import { withUserContext } from "../middleware/workspaceContext";

export type UserProfile = {
  userId: string;
  displayName: string | null;
  timezone: string;
};

type UserProfileRow = {
  user_id: string;
  display_name: string | null;
  timezone: string;
};

function mapRow(row: UserProfileRow): UserProfile {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    timezone: row.timezone,
  };
}

// HEL-203 PR 1: per-user UI preferences blob. Keyed under namespaces
// (currently `experienceMode`) so future PRs can extend without a
// schema change. See migrations/058_user_profile_preferences.sql.
export type UserPreferences = Record<string, unknown>;

export async function getUserPreferences(userId: string): Promise<UserPreferences> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("userId is required");
  }
  if (!isPostgresConfigured()) {
    return {};
  }
  return withUserContext(getPostgresPool(), normalizedUserId, async (client) => {
    const result = await client.query<{ preferences: UserPreferences | null }>(
      `SELECT preferences
         FROM user_profiles
        WHERE user_id = $1`,
      [normalizedUserId],
    );
    return result.rows[0]?.preferences ?? {};
  });
}

/**
 * Shallow-merges `patch` into the stored preferences JSONB blob. The
 * caller is responsible for shape validation — the store only enforces
 * "this is an object". We upsert a profile row so first-time writers
 * (OAuth-only users who haven't opened Profile Settings yet) succeed.
 */
export async function mergeUserPreferences(
  userId: string,
  patch: UserPreferences,
): Promise<UserPreferences> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("userId is required");
  }
  if (!isPostgresConfigured()) {
    throw new Error("User preferences persistence requires PostgreSQL");
  }
  return withUserContext(getPostgresPool(), normalizedUserId, async (client) => {
    const result = await client.query<{ preferences: UserPreferences }>(
      `INSERT INTO user_profiles (user_id, preferences)
         VALUES ($1, $2::jsonb)
         ON CONFLICT (user_id) DO UPDATE SET
           preferences = user_profiles.preferences || EXCLUDED.preferences,
           updated_at = now()
       RETURNING preferences`,
      [normalizedUserId, JSON.stringify(patch)],
    );
    return result.rows[0]?.preferences ?? {};
  });
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("userId is required");
  }

  if (isPostgresConfigured()) {
    return withUserContext(getPostgresPool(), normalizedUserId, async (client) => {
      const result = await client.query<UserProfileRow>(
        `SELECT user_id, display_name, timezone
           FROM user_profiles
          WHERE user_id = $1`,
        [normalizedUserId],
      );
      return result.rows[0] ? mapRow(result.rows[0]) : null;
    });
  }

  return null;
}

/**
 * Idempotently ensures a `user_profiles` row exists for the given user.
 *
 * Several writes (missions.created_by_user_id, hiring_plans.accepted_by_user_id,
 * etc.) FK into `user_profiles(user_id)`. The full profile is only created
 * when the user opens Profile Settings and saves — OAuth-only users never
 * trigger that flow, so their first write into a FK-bound table failed
 * with a constraint violation that surfaced as "Failed to create mission"
 * on the Hire page. Call this before any insert that targets the FK.
 *
 * Defaults: display_name NULL, timezone 'UTC' (overridable later via the
 * Profile Settings PATCH/PUT). When a caller is already in a workspace-scoped
 * transaction, pass the existing client so the insert shares that transaction.
 */
export async function ensureUserProfileExists(
  userId: string,
  client?: { query: (sql: string, params: unknown[]) => Promise<unknown> },
): Promise<void> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("userId is required");
  }
  if (!isPostgresConfigured()) {
    return;
  }
  const sql = `INSERT INTO user_profiles (user_id)
                 VALUES ($1)
                 ON CONFLICT (user_id) DO NOTHING`;
  if (client) {
    await client.query(sql, [normalizedUserId]);
    return;
  }
  await withUserContext(getPostgresPool(), normalizedUserId, async (c) => {
    await c.query(sql, [normalizedUserId]);
  });
}

export async function upsertUserProfile(input: {
  userId: string;
  displayName: string | null;
  timezone: string;
}): Promise<UserProfile> {
  const userId = input.userId.trim();
  const timezone = input.timezone.trim();

  if (!userId) {
    throw new Error("userId is required");
  }

  if (!timezone) {
    throw new Error("timezone is required");
  }

  if (isPostgresConfigured()) {
    const displayName = input.displayName?.trim() ? input.displayName.trim() : null;
    return withUserContext(getPostgresPool(), userId, async (client) => {
      const result = await client.query<UserProfileRow>(
        `INSERT INTO user_profiles (user_id, display_name, timezone)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           timezone = EXCLUDED.timezone,
           updated_at = now()
         RETURNING user_id, display_name, timezone`,
        [userId, displayName, timezone],
      );
      return mapRow(result.rows[0]);
    });
  }

  throw new Error("User profile persistence requires PostgreSQL");
}
