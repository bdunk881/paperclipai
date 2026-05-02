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
  if (!isPostgresConfigured()) {
    return null;
  }

  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("userId is required");
  }

  const result = await queryPostgres<UserProfileRow>(
    `SELECT user_id, display_name, timezone
       FROM user_profiles
      WHERE user_id = $1`,
    [normalizedUserId]
  );

  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function upsertUserProfile(input: {
  userId: string;
  displayName: string | null;
  timezone: string;
}): Promise<UserProfile> {
  if (!isPostgresConfigured()) {
    throw new Error("User profile persistence requires PostgreSQL");
  }

  const userId = input.userId.trim();
  const timezone = input.timezone.trim();

  if (!userId) {
    throw new Error("userId is required");
  }

  if (!timezone) {
    throw new Error("timezone is required");
  }

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
