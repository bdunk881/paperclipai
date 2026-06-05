-- HEL-613 — Inbound + delivery events → wake_events.
--
-- The comms gateway (HEL-609) is outbound-only; 098_comms_sends.sql deferred
-- "inbound webhooks ... to follow-up tickets". This is that follow-up. It adds
-- the primitives src/comms/webhooks/ needs to turn provider delivery / bounce /
-- complaint / inbound-SMS events into wake_events:
--
--   1. A lookup index so a delivery/bounce receipt can correlate back to its
--      originating comms_sends row by (provider, provider_message_id).
--   2. wake_events.dedupe_key — providers retry webhooks; the normalized event
--      carries a stable key so a retry is a no-op instead of a duplicate wake.
--   3. comms_inbound_routes — maps an inbound address/number (E.164 or email) to
--      the workspace (and optionally the agent) that owns it, so an inbound SMS
--      to an agent's number wakes the right stream. HEL-616 (per-agent number
--      provisioning) populates this; HEL-613 only reads it.
--   4. Two SECURITY DEFINER resolvers — a webhook has no session, so it can't use
--      the RLS workspace context to look anything up (comms_sends is FORCE RLS;
--      a raw SELECT returns zero rows, cf. migration 030). These run as the
--      function owner, bypass RLS for one narrow read, and return only the
--      tenancy fields the ingest needs to THEN publish a wake_event under the
--      resolved workspace's context. EXECUTE is revoked from PUBLIC and granted
--      only to server roles (mirrors migrations 060/092).

BEGIN;

-- 1. Correlate a provider event back to its send. Partial: only rows that have
--    actually been handed to a provider carry a provider_message_id.
CREATE INDEX IF NOT EXISTS comms_sends_provider_msg_idx
  ON comms_sends (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- 2. Webhook-retry dedupe for wake events. Partial-unique so only webhook events
--    (which set a dedupe_key) are constrained; existing sources stay NULL.
ALTER TABLE wake_events ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS wake_events_workspace_dedupe_idx
  ON wake_events (workspace_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- 3. Inbound address → owner routing. Decoupled attribution columns mirror
--    comms_sends: agent_id nullable, no hard FK churn beyond the workspace.
CREATE TABLE IF NOT EXISTS comms_inbound_routes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id     UUID REFERENCES agents(id) ON DELETE SET NULL,
  channel      TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'voice')),
  -- E.164 number for sms/voice; lowercased email for email. Caller normalizes.
  address      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One owner per (channel, address) globally — an inbound number/address routes
-- to exactly one workspace/agent. This is also the upsert target for HEL-616.
CREATE UNIQUE INDEX IF NOT EXISTS comms_inbound_routes_channel_address_idx
  ON comms_inbound_routes (channel, address);

ALTER TABLE comms_inbound_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_inbound_routes FORCE ROW LEVEL SECURITY;

-- Workspace-scoped management via the app_current_workspace_id() pattern
-- (mirrors comms_sends in 098). The pre-tenancy webhook read goes through the
-- SECURITY DEFINER resolver below, not this policy.
DROP POLICY IF EXISTS comms_inbound_routes_ws ON comms_inbound_routes;
CREATE POLICY comms_inbound_routes_ws ON comms_inbound_routes
  USING (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id = app_current_workspace_id()
  )
  WITH CHECK (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id = app_current_workspace_id()
  );

-- 4a. Resolve an inbound address to its owning workspace/agent (pre-tenancy).
--     Returns zero rows for an unrouted address — the caller drops the event.
CREATE OR REPLACE FUNCTION comms_resolve_inbound_route(p_channel text, p_address text)
RETURNS TABLE (workspace_id uuid, agent_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT r.workspace_id, r.agent_id
  FROM comms_inbound_routes AS r
  WHERE r.channel = p_channel AND r.address = p_address
  LIMIT 1;
$$;

ALTER FUNCTION comms_resolve_inbound_route(text, text)
  SET search_path = public, pg_catalog;
REVOKE EXECUTE ON FUNCTION comms_resolve_inbound_route(text, text) FROM PUBLIC;

COMMENT ON FUNCTION comms_resolve_inbound_route(text, text) IS
  'HEL-613: SECURITY DEFINER. Resolves an inbound (channel, address) to its owning workspace/agent without a workspace context. Returns 0 rows if unrouted.';

-- 4b. Resolve a provider message id back to the send that produced it, so a
--     delivery/bounce receipt can recover workspace/agent/mission (pre-tenancy).
CREATE OR REPLACE FUNCTION comms_resolve_send_by_provider_msg(p_provider text, p_message_id text)
RETURNS TABLE (comms_send_id uuid, workspace_id uuid, agent_id uuid, mission_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT s.id, s.workspace_id, s.agent_id, s.mission_id
  FROM comms_sends AS s
  WHERE s.provider = p_provider AND s.provider_message_id = p_message_id
  ORDER BY s.created_at DESC
  LIMIT 1;
$$;

ALTER FUNCTION comms_resolve_send_by_provider_msg(text, text)
  SET search_path = public, pg_catalog;
REVOKE EXECUTE ON FUNCTION comms_resolve_send_by_provider_msg(text, text) FROM PUBLIC;

COMMENT ON FUNCTION comms_resolve_send_by_provider_msg(text, text) IS
  'HEL-613: SECURITY DEFINER. Resolves a (provider, provider_message_id) back to its comms_sends tenancy (workspace/agent/mission) without a workspace context. Returns 0 rows if unknown.';

-- 4c. Resolve a workspace's owner user id (a guaranteed workspace member). The
--     wake_events RLS policy gates on membership, so a webhook ingest needs a
--     real member to publish under once it has resolved the workspace.
CREATE OR REPLACE FUNCTION comms_resolve_workspace_owner(p_workspace_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT w.owner_user_id
  FROM workspaces AS w
  WHERE w.id = p_workspace_id
  LIMIT 1;
$$;

ALTER FUNCTION comms_resolve_workspace_owner(uuid)
  SET search_path = public, pg_catalog;
REVOKE EXECUTE ON FUNCTION comms_resolve_workspace_owner(uuid) FROM PUBLIC;

COMMENT ON FUNCTION comms_resolve_workspace_owner(uuid) IS
  'HEL-613: SECURITY DEFINER. Returns a workspace''s owner user id (a member) so a sessionless webhook ingest can publish wake_events under that workspace''s membership-gated RLS.';

-- Grants — server-only roles (mirrors 060/092). Guarded so a less-provisioned
-- env (local dev without service_role / autoflow_api) doesn't trip the migration.
DO $$
DECLARE
  fn text;
  role_name text;
BEGIN
  FOR fn IN
    SELECT format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'comms_resolve_inbound_route',
        'comms_resolve_send_by_provider_msg',
        'comms_resolve_workspace_owner'
      )
  LOOP
    FOREACH role_name IN ARRAY ARRAY['postgres', 'service_role', 'autoflow_api'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO %I', fn, role_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;

COMMIT;
