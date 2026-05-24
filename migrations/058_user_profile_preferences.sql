-- HEL-203 PR 1: per-user UI preferences blob.
--
-- The v2 dashboard consolidation introduces a Pro/Simple experience toggle
-- (ExperienceModeContext) that must persist across sessions/devices. Rather
-- than mint a dedicated column per preference, we attach a free-form JSONB
-- blob to `user_profiles` so subsequent PRs (theme, density, default tabs)
-- can extend it without schema churn.
--
-- Keyed under `preferences.experienceMode` initially:
--   { "experienceMode": "simple" | "pro" }
--
-- Forward-only (repo convention). NOT NULL + default '{}' so existing rows
-- backfill safely; PATCH /api/user-profile/preferences will shallow-merge
-- via jsonb concat (see src/user/profileRoutes.ts).

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
