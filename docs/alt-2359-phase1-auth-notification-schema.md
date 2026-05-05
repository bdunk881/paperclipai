# ALT-2359 Phase 1 Schema Follow-up

This migration keeps `notification_preferences` as workspace defaults and adds
the minimum durable schema needed for user-level delivery overrides and account
merge auditing.

## New Tables

### `user_notification_overrides`

- Purpose: per-user notification settings layered on top of workspace defaults.
- Resolution model: if a `(workspace_id, user_id, channel, kind)` row exists, it
  overrides the matching `notification_preferences` row; otherwise the workspace
  default remains authoritative.
- RLS posture: enabled. This table is workspace-scoped and uses the hardened
  NULL-denial tenant isolation policy.

### `user_auth_identities`

- Purpose: provider-agnostic external identities linked to the existing local
  app user row in `social_auth_users`.
- Phase 1 posture: no RLS. Identity collision checks need to happen before the
  app has finalized workspace context, so reads should remain server-side only.
- Backfill: the migration seeds one identity row for every existing
  `social_auth_users` record so current Google users are represented
  immediately.

### `user_auth_merge_requests`

- Purpose: durable audit trail for merge prompts, approvals, rejections,
  cancellations, and expirations.
- Data model: keeps both FK references and provider snapshot columns so the
  audit trail survives partial linking states.
- RLS posture: enabled. Merge decisions are tenant-facing workflow events and
  use the hardened NULL-denial workspace policy.

## Legacy `social_auth_users` Migration Posture

- Phase 1 keeps `social_auth_users` as the canonical app-user row to avoid
  breaking the current auth code path.
- `user_auth_identities` is introduced beside it, not instead of it.
- Existing rows are backfilled into `user_auth_identities` during migration.
- Future auth work should dual-write:
  1. upsert the canonical `social_auth_users` row
  2. upsert the matching `user_auth_identities` row
  3. create a `user_auth_merge_requests` row when login requires merge consent
- A later cleanup phase can rename or replace `social_auth_users` once all auth
  providers and account-linking reads come from `user_auth_identities`.
