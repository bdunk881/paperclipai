-- Enforce control-plane RLS even when the application role owns the tables.
-- Without FORCE ROW LEVEL SECURITY, owner sessions can bypass tenant policies,
-- which makes runtime verification ineffective and weakens isolation guarantees.

ALTER TABLE provisioned_companies FORCE ROW LEVEL SECURITY;
ALTER TABLE control_plane_teams FORCE ROW LEVEL SECURITY;
ALTER TABLE control_plane_agents FORCE ROW LEVEL SECURITY;
ALTER TABLE control_plane_executions FORCE ROW LEVEL SECURITY;
