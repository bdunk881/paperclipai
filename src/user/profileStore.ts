import { isPostgresConfigured, queryPostgres } from "../db/postgres";

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

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("userId is required");
  }

  if (isPostgresConfigured()) {
    const result = await queryPostgres<UserProfileRow>(
      `SELECT user_id, display_name, timezone
         FROM user_profiles
        WHERE user_id = $1`,
      [normalizedUserId]
    );

    return result.rows[0] ? mapRow(result.rows[0]) : null;
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
 * Profile Settings PATCH/PUT). user_profiles has no RLS, so this is safe
 * to call from a plain pool client; passing one in lets callers share a
 * transaction or workspace-scoped session when convenient.
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
  await queryPostgres(sql, [normalizedUserId]);
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
    const result = await queryPostgres<UserProfileRow>(
      `INSERT INTO user_profiles (user_id, display_name, timezone)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         timezone = EXCLUDED.timezone,
         updated_at = now()
       RETURNING user_id, display_name, timezone`,
      [userId, displayName, timezone]
    );

    return mapRow(result.rows[0]);
  }

  throw new Error("User profile persistence requires PostgreSQL");
}
