-- HEL-728 — platform-admin comms reputation aggregation.
--
-- Cross-workspace per-tenant comms reputation for the admin console: send counts
-- by status + email bounce/complaint counts since a cutoff. comms_sends and
-- email_suppressions are FORCE RLS, and this is a platform-admin cross-workspace
-- read, so it's SECURITY DEFINER gated by app_is_platform_admin() — mirrors the
-- admin_* lookups in migration 060 (returns 0 rows when the platform_admin GUC
-- is unset; server-role-only EXECUTE).

BEGIN;

CREATE OR REPLACE FUNCTION admin_comms_reputation(p_since timestamptz)
RETURNS TABLE (
  workspace_id uuid,
  workspace_name text,
  sends_total bigint,
  sent bigint,
  failed bigint,
  suppressed bigint,
  email_sent bigint,
  email_bounces bigint,
  email_complaints bigint,
  last_send_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF NOT app_is_platform_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH sends AS (
    SELECT cs.workspace_id AS ws,
           count(*) AS n_total,
           count(*) FILTER (WHERE cs.status = 'sent') AS n_sent,
           count(*) FILTER (WHERE cs.status = 'failed') AS n_failed,
           count(*) FILTER (WHERE cs.status = 'suppressed') AS n_suppressed,
           count(*) FILTER (WHERE cs.channel = 'email' AND cs.status = 'sent') AS n_email_sent,
           max(cs.created_at) AS n_last_send_at
    FROM comms_sends cs
    WHERE cs.created_at >= p_since
    GROUP BY cs.workspace_id
  ),
  supp AS (
    SELECT es.workspace_id AS ws,
           count(*) FILTER (WHERE es.reason = 'bounce') AS n_bounces,
           count(*) FILTER (WHERE es.reason = 'complaint') AS n_complaints
    FROM email_suppressions es
    WHERE es.workspace_id IS NOT NULL AND es.created_at >= p_since
    GROUP BY es.workspace_id
  )
  SELECT s.ws,
         w.name,
         s.n_total,
         s.n_sent,
         s.n_failed,
         s.n_suppressed,
         s.n_email_sent,
         COALESCE(sp.n_bounces, 0),
         COALESCE(sp.n_complaints, 0),
         s.n_last_send_at
  FROM sends s
  JOIN workspaces w ON w.id = s.ws
  LEFT JOIN supp sp ON sp.ws = s.ws
  ORDER BY s.n_total DESC;
END;
$$;

ALTER FUNCTION admin_comms_reputation(timestamptz) SET search_path = public, pg_catalog;
REVOKE EXECUTE ON FUNCTION admin_comms_reputation(timestamptz) FROM PUBLIC;

COMMENT ON FUNCTION admin_comms_reputation(timestamptz) IS
  'HEL-728: platform-admin cross-workspace comms reputation (send statuses + email bounce/complaint counts since p_since). Returns 0 rows when the platform_admin GUC is unset.';

DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['postgres', 'service_role', 'autoflow_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION admin_comms_reputation(timestamptz) TO %I', role_name);
    END IF;
  END LOOP;
END $$;

COMMIT;
