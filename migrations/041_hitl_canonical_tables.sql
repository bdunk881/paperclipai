-- DASH-45: persist the HITL store off the five in-memory Maps onto Postgres.
--
-- Previously `src/hitl/hitlStore.ts` held schedules, checkpoints, artifact
-- comments, ask-CEO requests, and notifications in five top-level Map<>
-- structures. Every Fly restart wiped them, so the entire HITL surface
-- (Approvals page checkpoints, milestone gates, ask-CEO escalations) was
-- session-bound and silently lost across deploys.
--
-- These tables mirror the in-memory data model 1:1. RLS uses user_id +
-- company_id as the scope keys (same shape the store already enforces).
-- Indexes match the most common access patterns from hitlStore.ts.

CREATE TABLE IF NOT EXISTS hitl_schedules (
  id                       uuid PRIMARY KEY,
  user_id                  text NOT NULL,
  company_id               text NOT NULL,
  enabled                  boolean NOT NULL,
  timezone                 text NOT NULL,
  notification_channels    jsonb NOT NULL,
  weekly_review_json       jsonb NOT NULL,
  milestone_gate_json      jsonb NOT NULL,
  kpi_deviation_json       jsonb NOT NULL,
  created_at               timestamptz NOT NULL,
  updated_at               timestamptz NOT NULL,
  UNIQUE (user_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_hitl_schedules_scope
  ON hitl_schedules (user_id, company_id);


CREATE TABLE IF NOT EXISTS hitl_checkpoints (
  id                       uuid PRIMARY KEY,
  user_id                  text NOT NULL,
  company_id               text NOT NULL,
  trigger_type             text NOT NULL CHECK (
    trigger_type IN ('end_of_week_review', 'milestone_gate', 'kpi_deviation', 'manual')
  ),
  source                   text NOT NULL CHECK (source IN ('system', 'manual')),
  title                    text NOT NULL,
  description              text,
  status                   text NOT NULL CHECK (
    status IN ('pending', 'acknowledged', 'resolved', 'dismissed')
  ),
  due_at                   timestamptz,
  artifact_refs            jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata                 jsonb,
  notification_ids         jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at               timestamptz NOT NULL,
  updated_at               timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hitl_checkpoints_scope
  ON hitl_checkpoints (user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_hitl_checkpoints_status
  ON hitl_checkpoints (user_id, company_id, status);


CREATE TABLE IF NOT EXISTS hitl_artifact_comments (
  id                       uuid PRIMARY KEY,
  user_id                  text NOT NULL,
  company_id               text NOT NULL,
  artifact_kind            text NOT NULL CHECK (
    artifact_kind IN ('ticket', 'approval', 'run', 'document', 'workflow_step', 'other')
  ),
  artifact_id              text NOT NULL,
  artifact_title           text,
  artifact_path            text,
  artifact_version         text,
  anchor_json              jsonb,
  body                     text NOT NULL,
  status                   text NOT NULL CHECK (status IN ('open', 'resolved')),
  routing_json             jsonb NOT NULL,
  notification_ids         jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at               timestamptz NOT NULL,
  updated_at               timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hitl_artifact_comments_scope
  ON hitl_artifact_comments (user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_hitl_artifact_comments_artifact
  ON hitl_artifact_comments (user_id, company_id, artifact_id);


CREATE TABLE IF NOT EXISTS hitl_ask_ceo_requests (
  id                       uuid PRIMARY KEY,
  user_id                  text NOT NULL,
  company_id               text NOT NULL,
  question                 text NOT NULL,
  context_json             jsonb,
  status                   text NOT NULL CHECK (status IN ('answered')),
  response_json            jsonb NOT NULL,
  created_at               timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hitl_ask_ceo_scope
  ON hitl_ask_ceo_requests (user_id, company_id);


CREATE TABLE IF NOT EXISTS hitl_notifications (
  id                       uuid PRIMARY KEY,
  user_id                  text NOT NULL,
  company_id               text NOT NULL,
  kind                     text NOT NULL CHECK (
    kind IN ('checkpoint', 'artifact_comment', 'ask_ceo_response')
  ),
  channel                  text NOT NULL CHECK (
    channel IN ('inbox', 'email', 'agent_wake')
  ),
  recipient_type           text NOT NULL CHECK (recipient_type IN ('agent', 'user')),
  recipient_id             text NOT NULL,
  status                   text NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  payload                  jsonb NOT NULL,
  created_at               timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hitl_notifications_scope
  ON hitl_notifications (user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_hitl_notifications_recipient
  ON hitl_notifications (user_id, company_id, recipient_type, recipient_id);
