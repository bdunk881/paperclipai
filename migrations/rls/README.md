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
   The current schema is workspace-level by construction: only `workspace_id` exists, and uniqueness is `(workspace_id, channel, kind)`. Brad should confirm that workspace-scoped visibility is correct until a user-level schema exists.
3. `workflow_runs`
   The draft hides rows where `user_id IS NULL`. Brad should confirm that backend/system runs should stay invisible to client roles.
4. `generated_reports`
   The draft keeps reports user-private even when `team_id` is present. Brad should confirm that team-level sharing is intentionally deferred.
5. Agent memory tables
   The current Phase 1 posture keeps `agent_memory_*` and `agent_heartbeat_logs` out of client JWT sessions, but backend agents still need cross-agent reads. Brad should review that as a backend-shared design, not a per-user privacy model.
6. External auth linking
   `social_auth_users` is not a true account-link table. Brad should review the follow-up recommendation for a provider-agnostic identity-link table so existing local accounts can be merged only after explicit user consent.

Validation already completed:

- Supabase project `undvoetvdjkhiyqhtypt`
- Representative RLS checks passed for:
  - `user_profiles`
  - `ticket_updates`
  - `agent_heartbeat_logs`

Sign-off target:

- Brad approval on the canonical SQL in `supabase/migrations/20260505054500_alt_2321_phase1b_rls_draft.sql`
- No promotion from `migration` to `staging` until that approval is explicit in the issue thread
