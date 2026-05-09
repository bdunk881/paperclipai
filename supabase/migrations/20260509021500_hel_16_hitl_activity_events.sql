-- HEL-16: Canonical HITL approvals, tickets, and activity events
-- Supabase-managed mirror of migrations/022_hitl_activity_events.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS public.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  step_id text NOT NULL,
  tier text NOT NULL DEFAULT 'standard'
    CHECK (tier IN ('lite', 'standard', 'power', 'manual', 'policy')),
  status text NOT NULL
    CHECK (status IN ('pending', 'approved', 'rejected', 'request_changes', 'timed_out', 'cancelled')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by_user_id text,
  decided_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT approvals_decision_requires_actor
    CHECK (decided_at IS NULL OR decided_by_user_id IS NOT NULL)
);

INSERT INTO public.approvals (
  id,
  run_id,
  step_id,
  tier,
  status,
  requested_at,
  decided_by_user_id,
  decided_at,
  payload
)
SELECT
  id,
  run_id,
  step_id,
  'standard',
  status,
  requested_at,
  CASE WHEN resolved_at IS NOT NULL THEN assignee ELSE NULL END,
  resolved_at,
  jsonb_build_object(
    'legacy_table', 'approval_requests',
    'user_id', user_id,
    'template_name', template_name,
    'step_name', step_name,
    'assignee', assignee,
    'message', message,
    'timeout_minutes', timeout_minutes,
    'comment', comment
  )
FROM public.approval_requests
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_approvals_run_requested
  ON public.approvals (run_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_status_requested
  ON public.approvals (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_run_step
  ON public.approvals (run_id, step_id);

ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approvals_run_owner_or_assignee ON public.approvals;
CREATE POLICY approvals_run_owner_or_assignee
  ON public.approvals
  USING (
    public.app_current_user_id() IS NOT NULL
    AND (
      decided_by_user_id = public.app_current_user_id()
      OR payload ->> 'user_id' = public.app_current_user_id()
      OR payload ->> 'assignee' = public.app_current_user_id()
      OR EXISTS (
        SELECT 1
        FROM public.workflow_runs
        WHERE workflow_runs.id = approvals.run_id
          AND workflow_runs.user_id = public.app_current_user_id()
      )
    )
  )
  WITH CHECK (
    public.app_current_user_id() IS NOT NULL
    AND (
      decided_by_user_id = public.app_current_user_id()
      OR payload ->> 'user_id' = public.app_current_user_id()
      OR payload ->> 'assignee' = public.app_current_user_id()
      OR EXISTS (
        SELECT 1
        FROM public.workflow_runs
        WHERE workflow_runs.id = approvals.run_id
          AND workflow_runs.user_id = public.app_current_user_id()
      )
    )
  );

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS body text,
  ADD COLUMN IF NOT EXISTS assigned_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_user_id text;

UPDATE public.tickets
SET body = description
WHERE body IS NULL
  AND description IS NOT NULL;

UPDATE public.tickets
SET body = ''
WHERE body IS NULL;

ALTER TABLE public.tickets
  ALTER COLUMN body SET DEFAULT '',
  ALTER COLUMN body SET NOT NULL;

UPDATE public.tickets
SET assigned_agent_id = ticket_assignments.actor_id::uuid
FROM public.ticket_assignments
WHERE ticket_assignments.ticket_id = tickets.id
  AND ticket_assignments.actor_type = 'agent'
  AND ticket_assignments.role = 'primary'
  AND ticket_assignments.actor_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND tickets.assigned_agent_id IS NULL;

UPDATE public.tickets
SET assigned_user_id = ticket_assignments.actor_id
FROM public.ticket_assignments
WHERE ticket_assignments.ticket_id = tickets.id
  AND ticket_assignments.actor_type = 'user'
  AND ticket_assignments.role = 'primary'
  AND tickets.assigned_user_id IS NULL;

CREATE OR REPLACE FUNCTION public.sync_ticket_body_description()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.body, '') = '' AND COALESCE(NEW.description, '') <> '' THEN
      NEW.body := NEW.description;
    ELSIF COALESCE(NEW.description, '') = '' AND COALESCE(NEW.body, '') <> '' THEN
      NEW.description := NEW.body;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.description IS DISTINCT FROM OLD.description
     AND NEW.body IS NOT DISTINCT FROM OLD.body THEN
    NEW.body := NEW.description;
  ELSIF NEW.body IS DISTINCT FROM OLD.body
        AND NEW.description IS NOT DISTINCT FROM OLD.description THEN
    NEW.description := NEW.body;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tickets_sync_body_description ON public.tickets;
CREATE TRIGGER tickets_sync_body_description
  BEFORE INSERT OR UPDATE OF body, description ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_ticket_body_description();

CREATE INDEX IF NOT EXISTS idx_tickets_workspace_assigned_agent
  ON public.tickets (workspace_id, assigned_agent_id, created_at DESC)
  WHERE assigned_agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_workspace_assigned_user
  ON public.tickets (workspace_id, assigned_user_id, created_at DESC)
  WHERE assigned_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (length(kind) > 0 AND length(kind) <= 128),
  actor jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(actor) = 'object'),
  subject jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(subject) = 'object'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_events_workspace_occurred
  ON public.activity_events (workspace_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_events_workspace_kind_occurred
  ON public.activity_events (workspace_id, kind, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_events_subject_gin
  ON public.activity_events USING gin (subject);

INSERT INTO public.activity_events (
  id,
  workspace_id,
  kind,
  actor,
  subject,
  payload,
  occurred_at,
  created_at
)
SELECT
  (
    substr(md5('ticket_updates:' || ticket_updates.id::text), 1, 8) || '-' ||
    substr(md5('ticket_updates:' || ticket_updates.id::text), 9, 4) || '-' ||
    substr(md5('ticket_updates:' || ticket_updates.id::text), 13, 4) || '-' ||
    substr(md5('ticket_updates:' || ticket_updates.id::text), 17, 4) || '-' ||
    substr(md5('ticket_updates:' || ticket_updates.id::text), 21, 12)
  )::uuid,
  tickets.workspace_id,
  CASE
    WHEN ticket_updates.metadata_json ? 'event'
      THEN 'ticket.' || replace(ticket_updates.metadata_json ->> 'event', '_', '.')
    ELSE 'ticket.' || ticket_updates.update_type
  END,
  jsonb_build_object(
    'type', ticket_updates.actor_type,
    'id', ticket_updates.actor_id
  ),
  jsonb_build_object(
    'type', 'ticket',
    'id', tickets.id,
    'label', tickets.title
  ),
  jsonb_build_object(
    'summary', ticket_updates.content,
    'data', jsonb_build_object(
      'updateType', ticket_updates.update_type,
      'content', ticket_updates.content,
      'metadata', ticket_updates.metadata_json,
      'legacy_update_id', ticket_updates.id
    )
  ),
  ticket_updates.created_at,
  ticket_updates.created_at
FROM public.ticket_updates
JOIN public.tickets ON tickets.id = ticket_updates.ticket_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.activity_events (
  id,
  workspace_id,
  kind,
  actor,
  subject,
  payload,
  occurred_at,
  created_at
)
SELECT
  (
    substr(md5('observability_events:' || observability_events.event_id), 1, 8) || '-' ||
    substr(md5('observability_events:' || observability_events.event_id), 9, 4) || '-' ||
    substr(md5('observability_events:' || observability_events.event_id), 13, 4) || '-' ||
    substr(md5('observability_events:' || observability_events.event_id), 17, 4) || '-' ||
    substr(md5('observability_events:' || observability_events.event_id), 21, 12)
  )::uuid,
  resolved.workspace_id,
  observability_events.type,
  jsonb_strip_nulls(jsonb_build_object(
    'type', observability_events.actor_type,
    'id', observability_events.actor_id,
    'label', observability_events.actor_label
  )),
  jsonb_strip_nulls(jsonb_build_object(
    'type', observability_events.subject_type,
    'id', observability_events.subject_id,
    'label', observability_events.subject_label,
    'parentType', observability_events.subject_parent_type,
    'parentId', observability_events.subject_parent_id
  )),
  jsonb_build_object(
    'summary', observability_events.summary,
    'category', observability_events.category,
    'data', observability_events.payload_json,
    'legacy_event_id', observability_events.event_id,
    'legacy_sequence', observability_events.sequence
  ),
  observability_events.occurred_at,
  observability_events.created_at
FROM public.observability_events
JOIN LATERAL (
  SELECT COALESCE(workspace_parent.id, team_parent.workspace_id) AS workspace_id
  FROM (SELECT 1) seed
  LEFT JOIN public.workspaces workspace_parent
    ON observability_events.subject_parent_type = 'workspace'
   AND observability_events.subject_parent_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND workspace_parent.id = observability_events.subject_parent_id::uuid
  LEFT JOIN public.agent_teams team_parent
    ON observability_events.subject_parent_type = 'team'
   AND observability_events.subject_parent_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND team_parent.id = observability_events.subject_parent_id::uuid
) resolved ON resolved.workspace_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS activity_events_tenant_isolation ON public.activity_events;
CREATE POLICY activity_events_tenant_isolation
  ON public.activity_events
  USING (
    public.app_current_workspace_id() IS NOT NULL
    AND workspace_id = public.app_current_workspace_id()
  )
  WITH CHECK (
    public.app_current_workspace_id() IS NOT NULL
    AND workspace_id = public.app_current_workspace_id()
  );

DROP POLICY IF EXISTS activity_events_no_update ON public.activity_events;
CREATE POLICY activity_events_no_update
  ON public.activity_events
  AS RESTRICTIVE
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS activity_events_no_delete ON public.activity_events;
CREATE POLICY activity_events_no_delete
  ON public.activity_events
  AS RESTRICTIVE
  FOR DELETE
  USING (false);

COMMIT;
