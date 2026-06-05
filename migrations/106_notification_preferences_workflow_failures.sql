-- HEL-365: allow a `workflow_failures` notification preference so a workspace
-- can opt out of the workflow-failure digest email.
--
-- The digest job (src/engine/failureDigest) reads notification_preferences for
-- (workspace_id, channel='email', kind='workflow_failures') and skips the
-- workspace when that row exists with enabled=false. The kind must be a valid
-- CHECK value for such a row to exist, so extend the constraint. (We don't
-- auto-provision the row for every workspace — absence means the default,
-- "send" — so the shared preference matrix is unchanged.)
--
-- Inline CHECK constraints from migration 013 are auto-named
-- `<table>_<column>_check`; drop + re-add with the extended value set.

alter table notification_preferences
  drop constraint if exists notification_preferences_kind_check;
alter table notification_preferences
  add constraint notification_preferences_kind_check
  check (kind in ('approvals','milestones','kpi_alerts','budget_alerts','kill_switch','workflow_failures'));
