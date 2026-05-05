# ALT-2321 RLS Review Packet

This directory is the review entrypoint for Brad's Phase 1b sign-off on the `migration` branch.

Canonical review artifacts:

- [supabase/migrations/20260505054500_alt_2321_phase1b_rls_draft.sql](../../supabase/migrations/20260505054500_alt_2321_phase1b_rls_draft.sql)
- [docs/alt-2321-rls-review-matrix.md](../../docs/alt-2321-rls-review-matrix.md)
- [docs/alt-2321-supabase-schema-plan.md](../../docs/alt-2321-supabase-schema-plan.md)

Review scope:

- Check every drafted policy family for the correct tenancy primitive:
  - workspace-scoped
  - user-scoped
  - parent-inherited
  - service-role-only
- Confirm SELECT / INSERT / UPDATE / DELETE posture is appropriate for each table.
- Confirm there is no cross-user or cross-workspace leak path.
- Confirm the two-user mental model holds for any table that is user-visible.

Highest-risk review points:

1. `approval_requests`
   The draft exposes records to both `user_id` and `assignee`. Brad should confirm that mixed user/agent identity text values are acceptable for this phase.
2. `notification_preferences`
   The current schema is workspace-level by construction: only `workspace_id` exists, and uniqueness is `(workspace_id, channel, kind)`. Brad should confirm that Phase 1 treats these rows as workspace defaults, with user-level overrides coming in a follow-up schema.
3. Agent memory tables
   The current Phase 1 posture keeps `agent_memory_*` and `agent_heartbeat_logs` out of client JWT sessions, but backend agents still need same-workspace cross-agent reads. Brad should review that as a backend-shared model with future workspace/team isolation and explicit cross-workspace opt-in.
4. `workflow_runs`
   The draft hides rows where `user_id IS NULL`. Brad should confirm that backend/system runs should stay invisible to client roles.
5. `generated_reports`
   The draft keeps reports user-private even when `team_id` is present. Brad should confirm that team-level sharing is intentionally deferred.
6. External auth linking
   `social_auth_users` is not a true account-link table. Brad should review the follow-up recommendation for `user_auth_identities` plus `user_auth_merge_requests` so existing local accounts can be merged only after explicit user consent.

Accepted follow-up schema direction from review:

- keep `notification_preferences` as workspace defaults
- add a separate user-level notification override table
- add provider-agnostic `user_auth_identities`
- add durable `user_auth_merge_requests` audit rows
- keep agent memory backend-only until workspace/team isolation and explicit cross-workspace sharing rules are modeled

Validation already completed:

- Supabase project `undvoetvdjkhiyqhtypt`
- Representative RLS checks passed for:
  - `user_profiles`
  - `ticket_updates`
  - `agent_heartbeat_logs`

Sign-off target:

- Brad approval on the canonical SQL in `supabase/migrations/20260505054500_alt_2321_phase1b_rls_draft.sql`
- No promotion from `migration` to `staging` until that approval is explicit in the issue thread
