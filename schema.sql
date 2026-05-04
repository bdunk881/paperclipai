--
-- PostgreSQL database dump
--

\restrict N89ikM41IW4kkK9CYCd8bPa0YMtCkgSp7PToBFnRx6dXRsjY1tGa3h5eosuergY

-- Dumped from database version 16.13 (Homebrew)
-- Dumped by pg_dump version 16.13 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: observability; Type: SCHEMA; Schema: -; Owner: paperclip
--

CREATE SCHEMA observability;


ALTER SCHEMA observability OWNER TO paperclip;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: apply_retention(integer, integer, integer); Type: FUNCTION; Schema: observability; Owner: paperclip
--

CREATE FUNCTION observability.apply_retention(raw_retention_days integer DEFAULT 30, rollup_15m_retention_days integer DEFAULT 180, rollup_daily_retention_days integer DEFAULT 730) RETURNS void
    LANGUAGE plpgsql
    AS $_$
DECLARE
  child_record record;
  partition_day date;
BEGIN
  IF raw_retention_days <= 0 THEN
    RAISE EXCEPTION 'raw_retention_days must be > 0';
  END IF;

  FOR child_record IN
    SELECT child.relname AS partition_name
    FROM pg_inherits
    JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
    JOIN pg_class child ON child.oid = pg_inherits.inhrelid
    JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    WHERE parent_ns.nspname = 'observability'
      AND parent.relname = 'events'
      AND child_ns.nspname = 'observability'
      AND child.relname ~ '^events_[0-9]{8}$'
  LOOP
    partition_day := to_date(substring(child_record.partition_name FROM 'events_([0-9]{8})'), 'YYYYMMDD');
    IF partition_day < CURRENT_DATE - raw_retention_days THEN
      EXECUTE format('DROP TABLE IF EXISTS observability.%I', child_record.partition_name);
    END IF;
  END LOOP;

  DELETE FROM observability.rollups_15m
  WHERE bucket_start < now() - make_interval(days => rollup_15m_retention_days);

  DELETE FROM observability.rollups_daily
  WHERE bucket_date < CURRENT_DATE - rollup_daily_retention_days;
END;
$_$;


ALTER FUNCTION observability.apply_retention(raw_retention_days integer, rollup_15m_retention_days integer, rollup_daily_retention_days integer) OWNER TO paperclip;

--
-- Name: ensure_event_partitions(date, integer); Type: FUNCTION; Schema: observability; Owner: paperclip
--

CREATE FUNCTION observability.ensure_event_partitions(start_date date DEFAULT (CURRENT_DATE - 1), days_ahead integer DEFAULT 14) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  partition_day date;
  partition_name text;
BEGIN
  IF days_ahead < 0 THEN
    RAISE EXCEPTION 'days_ahead must be >= 0';
  END IF;

  FOR partition_day IN
    SELECT generate_series(start_date, start_date + days_ahead, interval '1 day')::date
  LOOP
    partition_name := format('events_%s', to_char(partition_day, 'YYYYMMDD'));

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS observability.%I PARTITION OF observability.events
       FOR VALUES FROM (%L) TO (%L)',
      partition_name,
      partition_day::timestamptz,
      (partition_day + 1)::timestamptz
    );
  END LOOP;
END;
$$;


ALTER FUNCTION observability.ensure_event_partitions(start_date date, days_ahead integer) OWNER TO paperclip;

--
-- Name: refresh_rollups(interval); Type: FUNCTION; Schema: observability; Owner: paperclip
--

CREATE FUNCTION observability.refresh_rollups(lookback interval DEFAULT '2 days'::interval) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO observability.rollups_15m (
    bucket_start,
    workspace_id,
    source,
    event_type,
    status,
    event_count,
    error_count,
    total_duration_ms,
    total_cost_usd,
    first_event_at,
    last_event_at,
    updated_at
  )
  SELECT
    date_bin('15 minutes', occurred_at, '2000-01-01 00:00:00+00'::timestamptz) AS bucket_start,
    workspace_id,
    source,
    event_type,
    COALESCE(status, 'unknown') AS status,
    COUNT(*) AS event_count,
    COUNT(*) FILTER (WHERE status IN ('error', 'failed')) AS error_count,
    COALESCE(SUM(duration_ms), 0)::bigint AS total_duration_ms,
    COALESCE(SUM(cost_usd), 0)::numeric(16, 6) AS total_cost_usd,
    MIN(occurred_at) AS first_event_at,
    MAX(occurred_at) AS last_event_at,
    now() AS updated_at
  FROM observability.events
  WHERE occurred_at >= now() - lookback
  GROUP BY 1, 2, 3, 4, 5
  ON CONFLICT (bucket_start, workspace_id, source, event_type, status) DO UPDATE
  SET
    event_count = EXCLUDED.event_count,
    error_count = EXCLUDED.error_count,
    total_duration_ms = EXCLUDED.total_duration_ms,
    total_cost_usd = EXCLUDED.total_cost_usd,
    first_event_at = EXCLUDED.first_event_at,
    last_event_at = EXCLUDED.last_event_at,
    updated_at = now();

  INSERT INTO observability.rollups_daily (
    bucket_date,
    workspace_id,
    source,
    event_type,
    status,
    event_count,
    error_count,
    total_duration_ms,
    total_cost_usd,
    first_event_at,
    last_event_at,
    updated_at
  )
  SELECT
    occurred_at::date AS bucket_date,
    workspace_id,
    source,
    event_type,
    COALESCE(status, 'unknown') AS status,
    COUNT(*) AS event_count,
    COUNT(*) FILTER (WHERE status IN ('error', 'failed')) AS error_count,
    COALESCE(SUM(duration_ms), 0)::bigint AS total_duration_ms,
    COALESCE(SUM(cost_usd), 0)::numeric(16, 6) AS total_cost_usd,
    MIN(occurred_at) AS first_event_at,
    MAX(occurred_at) AS last_event_at,
    now() AS updated_at
  FROM observability.events
  WHERE occurred_at >= now() - lookback
  GROUP BY 1, 2, 3, 4, 5
  ON CONFLICT (bucket_date, workspace_id, source, event_type, status) DO UPDATE
  SET
    event_count = EXCLUDED.event_count,
    error_count = EXCLUDED.error_count,
    total_duration_ms = EXCLUDED.total_duration_ms,
    total_cost_usd = EXCLUDED.total_cost_usd,
    first_event_at = EXCLUDED.first_event_at,
    last_event_at = EXCLUDED.last_event_at,
    updated_at = now();
END;
$$;


ALTER FUNCTION observability.refresh_rollups(lookback interval) OWNER TO paperclip;

--
-- Name: app_current_user_id(); Type: FUNCTION; Schema: public; Owner: paperclip
--

CREATE FUNCTION public.app_current_user_id() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')
$$;


ALTER FUNCTION public.app_current_user_id() OWNER TO paperclip;

--
-- Name: app_current_workspace_id(); Type: FUNCTION; Schema: public; Owner: paperclip
--

CREATE FUNCTION public.app_current_workspace_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  SELECT NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
$$;


ALTER FUNCTION public.app_current_workspace_id() OWNER TO paperclip;

--
-- Name: enforce_email_send_workspace_match(); Type: FUNCTION; Schema: public; Owner: paperclip
--

CREATE FUNCTION public.enforce_email_send_workspace_match() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  campaign_workspace_id uuid;
  lead_workspace_id uuid;
BEGIN
  SELECT workspace_id INTO campaign_workspace_id FROM campaigns WHERE id = NEW.campaign_id;
  IF campaign_workspace_id IS NULL THEN
    RAISE EXCEPTION 'campaign % does not exist', NEW.campaign_id;
  END IF;

  SELECT workspace_id INTO lead_workspace_id FROM leads WHERE id = NEW.lead_id;
  IF lead_workspace_id IS NULL THEN
    RAISE EXCEPTION 'lead % does not exist', NEW.lead_id;
  END IF;

  IF campaign_workspace_id <> lead_workspace_id THEN
    RAISE EXCEPTION 'campaign % and lead % belong to different workspaces', NEW.campaign_id, NEW.lead_id;
  END IF;

  IF NEW.workspace_id <> campaign_workspace_id THEN
    RAISE EXCEPTION 'email_send workspace_id must match campaign and lead workspace';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.enforce_email_send_workspace_match() OWNER TO paperclip;

SET default_tablespace = '';

--
-- Name: events; Type: TABLE; Schema: observability; Owner: paperclip
--

CREATE TABLE observability.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source text NOT NULL,
    event_type text NOT NULL,
    metric_name text DEFAULT 'count'::text NOT NULL,
    entity_type text,
    entity_id text,
    status text DEFAULT 'unknown'::text NOT NULL,
    duration_ms integer,
    cost_usd numeric(14,6) DEFAULT 0 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
)
PARTITION BY RANGE (occurred_at);


ALTER TABLE observability.events OWNER TO paperclip;

SET default_table_access_method = heap;

--
-- Name: events_20260503; Type: TABLE; Schema: observability; Owner: paperclip
--

CREATE TABLE observability.events_20260503 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source text NOT NULL,
    event_type text NOT NULL,
    metric_name text DEFAULT 'count'::text NOT NULL,
    entity_type text,
    entity_id text,
    status text DEFAULT 'unknown'::text NOT NULL,
    duration_ms integer,
    cost_usd numeric(14,6) DEFAULT 0 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE observability.events_20260503 OWNER TO paperclip;

--
-- Name: events_20260504; Type: TABLE; Schema: observability; Owner: paperclip
--

CREATE TABLE observability.events_20260504 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source text NOT NULL,
    event_type text NOT NULL,
    metric_name text DEFAULT 'count'::text NOT NULL,
    entity_type text,
    entity_id text,
    status text DEFAULT 'unknown'::text NOT NULL,
    duration_ms integer,
    cost_usd numeric(14,6) DEFAULT 0 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE observability.events_20260504 OWNER TO paperclip;

--
-- Name: events_20260505; Type: TABLE; Schema: observability; Owner: paperclip
--

CREATE TABLE observability.events_20260505 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source text NOT NULL,
    event_type text NOT NULL,
    metric_name text DEFAULT 'count'::text NOT NULL,
    entity_type text,
    entity_id text,
    status text DEFAULT 'unknown'::text NOT NULL,
    duration_ms integer,
    cost_usd numeric(14,6) DEFAULT 0 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE observability.events_20260505 OWNER TO paperclip;

--
-- Name: events_20260506; Type: TABLE; Schema: observability; Owner: paperclip
--

CREATE TABLE observability.events_20260506 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source text NOT NULL,
    event_type text NOT NULL,
    metric_name text DEFAULT 'count'::text NOT NULL,
    entity_type text,
    entity_id text,
    status text DEFAULT 'unknown'::text NOT NULL,
    duration_ms integer,
    cost_usd numeric(14,6) DEFAULT 0 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE observability.events_20260506 OWNER TO paperclip;

--
-- Name: events_20260507; Type: TABLE; Schema: observability; Owner: paperclip
--

CREATE TABLE observability.events_20260507 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source text NOT NULL,
    event_type text NOT NULL,
    metric_name text DEFAULT 'count'::text NOT NULL,
    entity_type text,
    entity_id text,
    status text DEFAULT 'unknown'::text NOT NULL,
    duration_ms integer,
    cost_usd numeric(14,6) DEFAULT 0 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE observability.events_20260507 OWNER TO paperclip;

--
-- Name: events_20260508; Type: TABLE; Schema: observability; Owner: paperclip
--

CREATE TABLE observability.events_20260508 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source text NOT NULL,
    event_type text NOT NULL,
    metric_name text DEFAULT 'count'::text NOT NULL,
    entity_type text,
    entity_id text,
    status text DEFAULT 'unknown'::text NOT NULL,
    duration_ms integer,
    cost_usd numeric(14,6) DEFAULT 0 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE observability.events_20260508 OWNER TO paperclip;

--
-- Name: events_20260509; Type: TABLE; Schema: observability; Owner: paperclip
--

CREATE TABLE observability.events_20260509 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source text NOT NULL,
    event_type text NOT NULL,
    metric_name text DEFAULT 'count'::text NOT NULL,
    entity_type text,
    entity_id text,
    status text DEFAULT 'unknown'::text NOT NULL,
    duration_ms integer,
    cost_usd numeric(14,6) DEFAULT 0 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE observability.events_20260509 OWNER TO paperclip;

--
-- Name: events_20260510; Type: TABLE; Schema: observability; Owner: paperclip
--

CREATE TABLE observability.events_20260510 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source text NOT NULL,
    event_type text NOT NULL,
    metric_name text DEFAULT 'count'::text NOT NULL,
    entity_type text,
    entity_id text,
    status text DEFAULT 'unknown'::text NOT NULL,
    duration_ms integer,
    cost_usd numeric(14,6) DEFAULT 0 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE observability.events_20260510 OWNER TO paperclip;

--
-- Name: events_20260511; Type: TABLE; Schema: observability; Owner: paperclip
--

CREATE TABLE observability.events_20260511 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source text NOT NULL,
    event_type text NOT NULL,
    metric_name text DEFAULT 'count'::text NOT NULL,
    entity_type text,
    entity_id text,
    status text DEFAULT 'unknown'::text NOT NULL,
    duration_ms integer,
    cost_usd numeric(14,6) DEFAULT 0 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE observability.events_20260511 OWNER TO paperclip;

--
-- Name: events_20260512; Type: TABLE; Schema: observability; Owner: paperclip
--

CREATE TABLE observability.events_20260512 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source text NOT NULL,
    event_type text NOT NULL,
    metric_name text DEFAULT 'count'::text NOT NULL,
    entity_type text,
    entity_id text,
    status text DEFAULT 'unknown'::text NOT NULL,
    duration_ms integer,
    cost_usd numeric(14,6) DEFAULT 0 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE observability.events_20260512 OWNER TO paperclip;

--
-- Name: events_20260513; Type: TABLE; Schema: observability; Owner: paperclip
--

CREATE TABLE observability.events_20260513 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source text NOT NULL,
    event_type text NOT NULL,
    metric_name text DEFAULT 'count'::text NOT NULL,
    entity_type text,
    entity_id text,
    status text DEFAULT 'unknown'::text NOT NULL,
    duration_ms integer,
    cost_usd numeric(14,6) DEFAULT 0 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE observability.events_20260513 OWNER TO paperclip;

--
-- Name: events_20260514; Type: TABLE; Schema: observability; Owner: paperclip
--

CREATE TABLE observability.events_20260514 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source text NOT NULL,
    event_type text NOT NULL,
    metric_name text DEFAULT 'count'::text NOT NULL,
    entity_type text,
    entity_id text,
    status text DEFAULT 'unknown'::text NOT NULL,
    duration_ms integer,
    cost_usd numeric(14,6) DEFAULT 0 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE observability.events_20260514 OWNER TO paperclip;

--
-- Name: events_20260515; Type: TABLE; Schema: observability; Owner: paperclip
--

CREATE TABLE observability.events_20260515 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source text NOT NULL,
    event_type text NOT NULL,
    metric_name text DEFAULT 'count'::text NOT NULL,
    entity_type text,
    entity_id text,
    status text DEFAULT 'unknown'::text NOT NULL,
    duration_ms integer,
    cost_usd numeric(14,6) DEFAULT 0 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE observability.events_20260515 OWNER TO paperclip;

--
-- Name: events_20260516; Type: TABLE; Schema: observability; Owner: paperclip
--

CREATE TABLE observability.events_20260516 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source text NOT NULL,
    event_type text NOT NULL,
    metric_name text DEFAULT 'count'::text NOT NULL,
    entity_type text,
    entity_id text,
    status text DEFAULT 'unknown'::text NOT NULL,
    duration_ms integer,
    cost_usd numeric(14,6) DEFAULT 0 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE observability.events_20260516 OWNER TO paperclip;

--
-- Name: events_20260517; Type: TABLE; Schema: observability; Owner: paperclip
--

CREATE TABLE observability.events_20260517 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source text NOT NULL,
    event_type text NOT NULL,
    metric_name text DEFAULT 'count'::text NOT NULL,
    entity_type text,
    entity_id text,
    status text DEFAULT 'unknown'::text NOT NULL,
    duration_ms integer,
    cost_usd numeric(14,6) DEFAULT 0 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE observability.events_20260517 OWNER TO paperclip;

--
-- Name: events_default; Type: TABLE; Schema: observability; Owner: paperclip
--

CREATE TABLE observability.events_default (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source text NOT NULL,
    event_type text NOT NULL,
    metric_name text DEFAULT 'count'::text NOT NULL,
    entity_type text,
    entity_id text,
    status text DEFAULT 'unknown'::text NOT NULL,
    duration_ms integer,
    cost_usd numeric(14,6) DEFAULT 0 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE observability.events_default OWNER TO paperclip;

--
-- Name: rollups_15m; Type: TABLE; Schema: observability; Owner: paperclip
--

CREATE TABLE observability.rollups_15m (
    bucket_start timestamp with time zone NOT NULL,
    workspace_id uuid NOT NULL,
    source text NOT NULL,
    event_type text NOT NULL,
    status text NOT NULL,
    event_count bigint NOT NULL,
    error_count bigint NOT NULL,
    total_duration_ms bigint NOT NULL,
    total_cost_usd numeric(16,6) NOT NULL,
    first_event_at timestamp with time zone NOT NULL,
    last_event_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE observability.rollups_15m OWNER TO paperclip;

--
-- Name: rollups_daily; Type: TABLE; Schema: observability; Owner: paperclip
--

CREATE TABLE observability.rollups_daily (
    bucket_date date NOT NULL,
    workspace_id uuid NOT NULL,
    source text NOT NULL,
    event_type text NOT NULL,
    status text NOT NULL,
    event_count bigint NOT NULL,
    error_count bigint NOT NULL,
    total_duration_ms bigint NOT NULL,
    total_cost_usd numeric(16,6) NOT NULL,
    first_event_at timestamp with time zone NOT NULL,
    last_event_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE observability.rollups_daily OWNER TO paperclip;

--
-- Name: agent_heartbeat_logs; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.agent_heartbeat_logs (
    id text NOT NULL,
    user_id text NOT NULL,
    agent_id text NOT NULL,
    run_id text NOT NULL,
    status text,
    summary text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone,
    workspace_id text NOT NULL,
    memory_layer text DEFAULT 'agent'::text NOT NULL,
    team_id text,
    archived_at timestamp with time zone,
    CONSTRAINT agent_heartbeat_logs_memory_layer_check CHECK ((memory_layer = ANY (ARRAY['agent'::text, 'team'::text, 'company'::text])))
);


ALTER TABLE public.agent_heartbeat_logs OWNER TO paperclip;

--
-- Name: agent_memory_entries; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.agent_memory_entries (
    id text NOT NULL,
    user_id text NOT NULL,
    agent_id text NOT NULL,
    run_id text,
    scope text DEFAULT 'private'::text NOT NULL,
    key text NOT NULL,
    text_value text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    embedding jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone,
    entry_type text DEFAULT 'generic'::text NOT NULL,
    workspace_id text NOT NULL,
    memory_layer text DEFAULT 'agent'::text NOT NULL,
    team_id text,
    archived_at timestamp with time zone,
    CONSTRAINT agent_memory_entries_entry_type_check CHECK ((entry_type = ANY (ARRAY['generic'::text, 'ticket_close'::text]))),
    CONSTRAINT agent_memory_entries_memory_layer_check CHECK ((memory_layer = ANY (ARRAY['agent'::text, 'team'::text, 'company'::text]))),
    CONSTRAINT agent_memory_entries_scope_check CHECK ((scope = ANY (ARRAY['private'::text, 'shared'::text])))
);


ALTER TABLE public.agent_memory_entries OWNER TO paperclip;

--
-- Name: agent_memory_events; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.agent_memory_events (
    id text NOT NULL,
    user_id text NOT NULL,
    workspace_id text NOT NULL,
    agent_id text NOT NULL,
    run_id text,
    memory_layer text DEFAULT 'agent'::text NOT NULL,
    team_id text,
    entity_type text NOT NULL,
    event_type text NOT NULL,
    entity_id text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT agent_memory_events_entity_type_check CHECK ((entity_type = ANY (ARRAY['entry'::text, 'knowledge_fact'::text, 'heartbeat_log'::text]))),
    CONSTRAINT agent_memory_events_event_type_check CHECK ((event_type = ANY (ARRAY['created'::text, 'archived'::text]))),
    CONSTRAINT agent_memory_events_memory_layer_check CHECK ((memory_layer = ANY (ARRAY['agent'::text, 'team'::text, 'company'::text])))
);


ALTER TABLE public.agent_memory_events OWNER TO paperclip;

--
-- Name: agent_memory_kg_facts; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.agent_memory_kg_facts (
    id text NOT NULL,
    user_id text NOT NULL,
    agent_id text NOT NULL,
    run_id text,
    scope text DEFAULT 'private'::text NOT NULL,
    subject text NOT NULL,
    predicate text NOT NULL,
    object text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone,
    workspace_id text NOT NULL,
    memory_layer text DEFAULT 'agent'::text NOT NULL,
    team_id text,
    archived_at timestamp with time zone,
    CONSTRAINT agent_memory_kg_facts_memory_layer_check CHECK ((memory_layer = ANY (ARRAY['agent'::text, 'team'::text, 'company'::text]))),
    CONSTRAINT agent_memory_kg_facts_scope_check CHECK ((scope = ANY (ARRAY['private'::text, 'shared'::text])))
);


ALTER TABLE public.agent_memory_kg_facts OWNER TO paperclip;

--
-- Name: approval_notifications; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.approval_notifications (
    id uuid NOT NULL,
    approval_request_id uuid NOT NULL,
    run_id uuid NOT NULL,
    template_name text NOT NULL,
    step_id text NOT NULL,
    step_name text NOT NULL,
    recipient text NOT NULL,
    channel text NOT NULL,
    status text NOT NULL,
    payload_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    sent_at timestamp with time zone,
    error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT approval_notifications_channel_check CHECK ((channel = ANY (ARRAY['inbox'::text, 'email'::text]))),
    CONSTRAINT approval_notifications_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])))
);


ALTER TABLE public.approval_notifications OWNER TO paperclip;

--
-- Name: approval_requests; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.approval_requests (
    id uuid NOT NULL,
    run_id uuid NOT NULL,
    user_id text,
    template_name text NOT NULL,
    step_id text NOT NULL,
    step_name text NOT NULL,
    assignee text NOT NULL,
    message text NOT NULL,
    timeout_minutes integer NOT NULL,
    requested_at timestamp with time zone NOT NULL,
    status text NOT NULL,
    resolved_at timestamp with time zone,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT approval_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'request_changes'::text, 'timed_out'::text]))),
    CONSTRAINT approval_requests_timeout_minutes_check CHECK ((timeout_minutes > 0))
);


ALTER TABLE public.approval_requests OWNER TO paperclip;

--
-- Name: approval_tier_policies; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.approval_tier_policies (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    action_type text NOT NULL,
    mode text NOT NULL,
    spend_threshold_cents integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT approval_tier_policies_action_type_check CHECK ((action_type = ANY (ARRAY['spend_above_threshold'::text, 'contracts'::text, 'public_posts'::text, 'customer_facing_comms'::text, 'code_merges_to_prod'::text]))),
    CONSTRAINT approval_tier_policies_mode_check CHECK ((mode = ANY (ARRAY['auto_approve'::text, 'notify_only'::text, 'require_approval'::text]))),
    CONSTRAINT approval_tier_policies_spend_threshold_cents_check CHECK (((spend_threshold_cents IS NULL) OR (spend_threshold_cents >= 0)))
);


ALTER TABLE public.approval_tier_policies OWNER TO paperclip;

--
-- Name: campaigns; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.campaigns OWNER TO paperclip;

--
-- Name: connector_credentials; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.connector_credentials (
    service text NOT NULL,
    id text NOT NULL,
    user_id text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    record_data jsonb NOT NULL
);


ALTER TABLE public.connector_credentials OWNER TO paperclip;

--
-- Name: control_plane_agents; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.control_plane_agents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    team_id uuid NOT NULL,
    name text NOT NULL,
    role_key text NOT NULL,
    workflow_step_id text,
    workflow_step_kind text,
    model text,
    instructions text,
    budget_monthly_usd numeric(12,2) DEFAULT 0 NOT NULL,
    reporting_to_agent_id uuid,
    skills jsonb DEFAULT '[]'::jsonb NOT NULL,
    schedule jsonb DEFAULT '{"type": "manual"}'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    paused_by_company_lifecycle boolean DEFAULT false NOT NULL,
    current_execution_id uuid,
    last_heartbeat_at timestamp with time zone,
    last_heartbeat_status text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT control_plane_agents_budget_monthly_usd_check CHECK ((budget_monthly_usd >= (0)::numeric)),
    CONSTRAINT control_plane_agents_last_heartbeat_status_check CHECK (((last_heartbeat_status IS NULL) OR (last_heartbeat_status = ANY (ARRAY['queued'::text, 'running'::text, 'blocked'::text, 'completed'::text])))),
    CONSTRAINT control_plane_agents_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'terminated'::text])))
);

ALTER TABLE ONLY public.control_plane_agents FORCE ROW LEVEL SECURITY;


ALTER TABLE public.control_plane_agents OWNER TO paperclip;

--
-- Name: control_plane_audit_log; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.control_plane_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    actor_user_id text,
    actor_agent_id text,
    category text NOT NULL,
    action text NOT NULL,
    target_type text,
    target_id text,
    metadata jsonb,
    at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT control_plane_audit_log_action_check CHECK (((length(action) > 0) AND (length(action) <= 64))),
    CONSTRAINT control_plane_audit_log_actor_present CHECK (((actor_user_id IS NOT NULL) OR (actor_agent_id IS NOT NULL))),
    CONSTRAINT control_plane_audit_log_category_check CHECK ((category = ANY (ARRAY['secret'::text, 'provisioning'::text, 'team_lifecycle'::text, 'agent_lifecycle'::text, 'execution'::text, 'auth'::text, 'bypass_attempt'::text])))
);

ALTER TABLE ONLY public.control_plane_audit_log FORCE ROW LEVEL SECURITY;


ALTER TABLE public.control_plane_audit_log OWNER TO paperclip;

--
-- Name: control_plane_budget_alerts; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.control_plane_budget_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    team_id uuid NOT NULL,
    agent_id uuid,
    tool_name text,
    scope text NOT NULL,
    threshold numeric(6,4) NOT NULL,
    budget_usd numeric(12,2) NOT NULL,
    spent_usd numeric(12,2) NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT control_plane_budget_alerts_budget_usd_check CHECK ((budget_usd >= (0)::numeric)),
    CONSTRAINT control_plane_budget_alerts_scope_check CHECK ((scope = ANY (ARRAY['team'::text, 'agent'::text, 'tool'::text]))),
    CONSTRAINT control_plane_budget_alerts_spent_usd_check CHECK ((spent_usd >= (0)::numeric)),
    CONSTRAINT control_plane_budget_alerts_threshold_check CHECK (((threshold > (0)::numeric) AND (threshold <= (2)::numeric)))
);

ALTER TABLE ONLY public.control_plane_budget_alerts FORCE ROW LEVEL SECURITY;


ALTER TABLE public.control_plane_budget_alerts OWNER TO paperclip;

--
-- Name: control_plane_company_lifecycle; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.control_plane_company_lifecycle (
    user_id text NOT NULL,
    status text NOT NULL,
    pause_reason text,
    paused_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_run_id text NOT NULL,
    CONSTRAINT control_plane_company_lifecycle_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text])))
);


ALTER TABLE public.control_plane_company_lifecycle OWNER TO paperclip;

--
-- Name: control_plane_company_lifecycle_audit; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.control_plane_company_lifecycle_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    action text NOT NULL,
    reason text,
    run_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    affected_team_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    affected_agent_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT control_plane_company_lifecycle_audit_action_check CHECK ((action = ANY (ARRAY['pause'::text, 'resume'::text])))
);


ALTER TABLE public.control_plane_company_lifecycle_audit OWNER TO paperclip;

--
-- Name: control_plane_executions; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.control_plane_executions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    team_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    source_run_id text NOT NULL,
    source_workflow_step_id text NOT NULL,
    source_workflow_step_name text NOT NULL,
    task_id uuid,
    status text NOT NULL,
    applied_skills jsonb DEFAULT '[]'::jsonb NOT NULL,
    metadata jsonb,
    summary text,
    cost_usd numeric(12,4),
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    last_heartbeat_at timestamp with time zone DEFAULT now() NOT NULL,
    restart_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT control_plane_executions_restart_count_check CHECK ((restart_count >= 0)),
    CONSTRAINT control_plane_executions_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'blocked'::text, 'completed'::text, 'failed'::text, 'stopped'::text])))
);

ALTER TABLE ONLY public.control_plane_executions FORCE ROW LEVEL SECURITY;


ALTER TABLE public.control_plane_executions OWNER TO paperclip;

--
-- Name: control_plane_heartbeats; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.control_plane_heartbeats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    team_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    execution_id uuid,
    status text NOT NULL,
    summary text,
    cost_usd numeric(12,4),
    created_task_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT control_plane_heartbeats_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'blocked'::text, 'completed'::text])))
);

ALTER TABLE ONLY public.control_plane_heartbeats FORCE ROW LEVEL SECURITY;


ALTER TABLE public.control_plane_heartbeats OWNER TO paperclip;

--
-- Name: control_plane_secret_audit; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.control_plane_secret_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    company_id uuid NOT NULL,
    key text NOT NULL,
    action text NOT NULL,
    key_version integer DEFAULT 1 NOT NULL,
    metadata jsonb,
    at timestamp with time zone DEFAULT now() NOT NULL,
    actor_user_id text,
    actor_agent_id text,
    CONSTRAINT control_plane_secret_audit_action_check CHECK ((action = ANY (ARRAY['read'::text, 'read_failed'::text, 'write'::text, 'rotate'::text, 'delete'::text, 'list'::text]))),
    CONSTRAINT control_plane_secret_audit_actor_present CHECK (((actor_user_id IS NOT NULL) OR (actor_agent_id IS NOT NULL))),
    CONSTRAINT control_plane_secret_audit_key_version_check CHECK ((key_version >= 1))
);

ALTER TABLE ONLY public.control_plane_secret_audit FORCE ROW LEVEL SECURITY;


ALTER TABLE public.control_plane_secret_audit OWNER TO paperclip;

--
-- Name: control_plane_spend_entries; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.control_plane_spend_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    team_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    execution_id uuid,
    category text NOT NULL,
    cost_usd numeric(12,4) NOT NULL,
    model text,
    provider text,
    tool_name text,
    metadata jsonb,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT control_plane_spend_entries_category_check CHECK ((category = ANY (ARRAY['llm'::text, 'tool'::text, 'api'::text, 'compute'::text, 'ad_spend'::text, 'third_party'::text]))),
    CONSTRAINT control_plane_spend_entries_cost_usd_check CHECK ((cost_usd >= (0)::numeric))
);

ALTER TABLE ONLY public.control_plane_spend_entries FORCE ROW LEVEL SECURITY;


ALTER TABLE public.control_plane_spend_entries OWNER TO paperclip;

--
-- Name: control_plane_tasks; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.control_plane_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    team_id uuid NOT NULL,
    assigned_agent_id uuid,
    execution_id uuid,
    title text NOT NULL,
    description text,
    source_run_id text,
    source_workflow_step_id text,
    status text DEFAULT 'todo'::text NOT NULL,
    checked_out_by text,
    checked_out_at timestamp with time zone,
    audit_trail jsonb DEFAULT '[]'::jsonb NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT control_plane_tasks_status_check CHECK ((status = ANY (ARRAY['todo'::text, 'in_progress'::text, 'done'::text, 'blocked'::text])))
);

ALTER TABLE ONLY public.control_plane_tasks FORCE ROW LEVEL SECURITY;


ALTER TABLE public.control_plane_tasks OWNER TO paperclip;

--
-- Name: control_plane_teams; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.control_plane_teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    company_id uuid,
    name text NOT NULL,
    description text,
    workflow_template_id text,
    workflow_template_name text,
    deployment_mode text DEFAULT 'workflow_runtime'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    paused_by_company_lifecycle boolean DEFAULT false NOT NULL,
    restart_count integer DEFAULT 0 NOT NULL,
    budget_monthly_usd numeric(12,2) DEFAULT 0 NOT NULL,
    tool_budget_ceilings jsonb DEFAULT '{}'::jsonb NOT NULL,
    alert_thresholds jsonb DEFAULT '[0.8, 0.9, 1]'::jsonb NOT NULL,
    orchestration_enabled boolean DEFAULT true NOT NULL,
    last_heartbeat_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT control_plane_teams_budget_monthly_usd_check CHECK ((budget_monthly_usd >= (0)::numeric)),
    CONSTRAINT control_plane_teams_deployment_mode_check CHECK ((deployment_mode = ANY (ARRAY['workflow_runtime'::text, 'continuous_agents'::text]))),
    CONSTRAINT control_plane_teams_restart_count_check CHECK ((restart_count >= 0)),
    CONSTRAINT control_plane_teams_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'stopped'::text])))
);

ALTER TABLE ONLY public.control_plane_teams FORCE ROW LEVEL SECURITY;


ALTER TABLE public.control_plane_teams OWNER TO paperclip;

--
-- Name: email_sends; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.email_sends (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    step_number integer NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    sent_at timestamp with time zone,
    opened_at timestamp with time zone,
    replied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_sends_step_number_check CHECK ((step_number > 0))
);


ALTER TABLE public.email_sends OWNER TO paperclip;

--
-- Name: generated_reports; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.generated_reports (
    id uuid NOT NULL,
    user_id text NOT NULL,
    team_id uuid,
    kind text NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    period_start timestamp with time zone,
    period_end timestamp with time zone,
    template_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    sections_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    metrics_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    delivery_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.generated_reports OWNER TO paperclip;

--
-- Name: icp_profiles; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.icp_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    target_titles text[] DEFAULT ARRAY[]::text[] NOT NULL,
    industries text[] DEFAULT ARRAY[]::text[] NOT NULL,
    headcount_min integer,
    headcount_max integer,
    geographies text[] DEFAULT ARRAY[]::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT icp_profiles_check CHECK (((headcount_min IS NULL) OR (headcount_max IS NULL) OR (headcount_min <= headcount_max))),
    CONSTRAINT icp_profiles_headcount_max_check CHECK (((headcount_max IS NULL) OR (headcount_max >= 0))),
    CONSTRAINT icp_profiles_headcount_min_check CHECK (((headcount_min IS NULL) OR (headcount_min >= 0)))
);


ALTER TABLE public.icp_profiles OWNER TO paperclip;

--
-- Name: leads; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    icp_profile_id uuid,
    first_name text,
    last_name text,
    company text,
    title text,
    email text,
    enrichment_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.leads OWNER TO paperclip;

--
-- Name: llm_configs; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.llm_configs (
    id text NOT NULL,
    user_id text NOT NULL,
    provider text NOT NULL,
    label text NOT NULL,
    model text NOT NULL,
    api_key_encrypted text NOT NULL,
    api_key_masked text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT llm_configs_provider_check CHECK ((provider = ANY (ARRAY['openai'::text, 'anthropic'::text, 'gemini'::text, 'mistral'::text])))
);


ALTER TABLE public.llm_configs OWNER TO paperclip;

--
-- Name: memory_entries; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.memory_entries (
    id uuid NOT NULL,
    user_id text NOT NULL,
    workflow_id text,
    workflow_name text,
    agent_id text,
    key text NOT NULL,
    text_value text NOT NULL,
    ttl_seconds integer,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone
);


ALTER TABLE public.memory_entries OWNER TO paperclip;

--
-- Name: notification_channel_configs; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.notification_channel_configs (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    channel text NOT NULL,
    owner_user_id text NOT NULL,
    connection_id text,
    enabled boolean DEFAULT true NOT NULL,
    config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_channel_configs_channel_check CHECK ((channel = ANY (ARRAY['slack'::text, 'email'::text, 'sms'::text])))
);


ALTER TABLE public.notification_channel_configs OWNER TO paperclip;

--
-- Name: notification_deliveries; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.notification_deliveries (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    event_id uuid NOT NULL,
    channel text NOT NULL,
    cadence text NOT NULL,
    delivered_at timestamp with time zone,
    status text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_deliveries_cadence_check CHECK ((cadence = ANY (ARRAY['immediate'::text, 'daily'::text, 'weekly'::text]))),
    CONSTRAINT notification_deliveries_channel_check CHECK ((channel = ANY (ARRAY['slack'::text, 'email'::text, 'sms'::text]))),
    CONSTRAINT notification_deliveries_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text])))
);


ALTER TABLE public.notification_deliveries OWNER TO paperclip;

--
-- Name: notification_events; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.notification_events (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    severity text NOT NULL,
    source text,
    metadata_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_events_kind_check CHECK ((kind = ANY (ARRAY['approvals'::text, 'milestones'::text, 'kpi_alerts'::text, 'budget_alerts'::text, 'kill_switch'::text]))),
    CONSTRAINT notification_events_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text])))
);


ALTER TABLE public.notification_events OWNER TO paperclip;

--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.notification_preferences (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    channel text NOT NULL,
    kind text NOT NULL,
    cadence text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    muted_until timestamp with time zone,
    last_digest_sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_preferences_cadence_check CHECK ((cadence = ANY (ARRAY['off'::text, 'immediate'::text, 'daily'::text, 'weekly'::text]))),
    CONSTRAINT notification_preferences_channel_check CHECK ((channel = ANY (ARRAY['slack'::text, 'email'::text, 'sms'::text]))),
    CONSTRAINT notification_preferences_kind_check CHECK ((kind = ANY (ARRAY['approvals'::text, 'milestones'::text, 'kpi_alerts'::text, 'budget_alerts'::text, 'kill_switch'::text])))
);


ALTER TABLE public.notification_preferences OWNER TO paperclip;

--
-- Name: observability_events; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.observability_events (
    event_id text NOT NULL,
    sequence bigint NOT NULL,
    user_id text NOT NULL,
    category text NOT NULL,
    type text NOT NULL,
    actor_type text NOT NULL,
    actor_id text NOT NULL,
    actor_label text,
    subject_type text NOT NULL,
    subject_id text NOT NULL,
    subject_label text,
    subject_parent_type text,
    subject_parent_id text,
    summary text NOT NULL,
    payload_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT observability_events_category_check CHECK ((category = ANY (ARRAY['issue'::text, 'run'::text, 'heartbeat'::text, 'budget'::text, 'alert'::text])))
);


ALTER TABLE public.observability_events OWNER TO paperclip;

--
-- Name: provisioned_companies; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.provisioned_companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    external_company_id text,
    provisioned_workspace_id uuid DEFAULT gen_random_uuid() NOT NULL,
    provisioned_workspace_name text NOT NULL,
    provisioned_workspace_slug text NOT NULL,
    team_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    budget_monthly_usd numeric(12,2) DEFAULT 0 NOT NULL,
    allocated_budget_monthly_usd numeric(12,2) DEFAULT 0 NOT NULL,
    remaining_budget_monthly_usd numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT provisioned_companies_allocated_budget_monthly_usd_check CHECK ((allocated_budget_monthly_usd >= (0)::numeric)),
    CONSTRAINT provisioned_companies_budget_monthly_usd_check CHECK ((budget_monthly_usd >= (0)::numeric))
);

ALTER TABLE ONLY public.provisioned_companies FORCE ROW LEVEL SECURITY;


ALTER TABLE public.provisioned_companies OWNER TO paperclip;

--
-- Name: provisioned_company_secrets; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.provisioned_company_secrets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    company_id uuid NOT NULL,
    key text NOT NULL,
    ciphertext bytea NOT NULL,
    iv bytea NOT NULL,
    auth_tag bytea NOT NULL,
    key_version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    value_mask_suffix text,
    CONSTRAINT provisioned_company_secrets_auth_tag_length CHECK ((octet_length(auth_tag) = 16)),
    CONSTRAINT provisioned_company_secrets_iv_length CHECK ((octet_length(iv) = 12)),
    CONSTRAINT provisioned_company_secrets_key_version_check CHECK ((key_version >= 1)),
    CONSTRAINT provisioned_company_secrets_mask_suffix_length CHECK (((value_mask_suffix IS NULL) OR (char_length(value_mask_suffix) <= 4)))
);

ALTER TABLE ONLY public.provisioned_company_secrets FORCE ROW LEVEL SECURITY;


ALTER TABLE public.provisioned_company_secrets OWNER TO paperclip;

--
-- Name: social_auth_users; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.social_auth_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    display_name text,
    provider text NOT NULL,
    provider_user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT social_auth_users_provider_check CHECK ((provider = ANY (ARRAY['google'::text, 'facebook'::text, 'apple'::text])))
);


ALTER TABLE public.social_auth_users OWNER TO paperclip;

--
-- Name: ticket_assignments; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.ticket_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    actor_type text NOT NULL,
    actor_id text NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ticket_assignments_actor_type_check CHECK ((actor_type = ANY (ARRAY['agent'::text, 'user'::text]))),
    CONSTRAINT ticket_assignments_role_check CHECK ((role = ANY (ARRAY['primary'::text, 'collaborator'::text])))
);


ALTER TABLE public.ticket_assignments OWNER TO paperclip;

--
-- Name: ticket_notifications; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.ticket_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    run_id text,
    recipient_type text NOT NULL,
    recipient_id text NOT NULL,
    channel text NOT NULL,
    kind text NOT NULL,
    status text NOT NULL,
    payload_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    error text,
    CONSTRAINT ticket_notifications_channel_check CHECK ((channel = ANY (ARRAY['inbox'::text, 'email'::text, 'agent_wake'::text]))),
    CONSTRAINT ticket_notifications_kind_check CHECK ((kind = ANY (ARRAY['assignment'::text, 'mention'::text, 'close_requested'::text, 'status_change'::text, 'sla_at_risk'::text, 'sla_breached'::text]))),
    CONSTRAINT ticket_notifications_recipient_type_check CHECK ((recipient_type = ANY (ARRAY['agent'::text, 'user'::text]))),
    CONSTRAINT ticket_notifications_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])))
);


ALTER TABLE public.ticket_notifications OWNER TO paperclip;

--
-- Name: ticket_sla_policies; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.ticket_sla_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    priority text NOT NULL,
    first_response_target_json jsonb NOT NULL,
    resolution_target_json jsonb NOT NULL,
    at_risk_threshold numeric(5,4) DEFAULT 0.75 NOT NULL,
    escalation_json jsonb DEFAULT '{"notify": true, "autoReassign": false, "autoBumpPriority": false}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ticket_sla_policies_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text])))
);


ALTER TABLE public.ticket_sla_policies OWNER TO paperclip;

--
-- Name: ticket_sla_snapshots; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.ticket_sla_snapshots (
    ticket_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    policy_id uuid NOT NULL,
    priority text NOT NULL,
    state text NOT NULL,
    phase text NOT NULL,
    first_response_target_at timestamp with time zone NOT NULL,
    first_response_responded_at timestamp with time zone,
    resolution_target_at timestamp with time zone NOT NULL,
    paused_at timestamp with time zone,
    total_paused_minutes integer DEFAULT 0 NOT NULL,
    at_risk_notified_at timestamp with time zone,
    breached_at timestamp with time zone,
    escalation_applied_at timestamp with time zone,
    last_evaluated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ticket_sla_snapshots_phase_check CHECK ((phase = ANY (ARRAY['first_response'::text, 'resolution'::text, 'resolved'::text, 'paused'::text]))),
    CONSTRAINT ticket_sla_snapshots_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text]))),
    CONSTRAINT ticket_sla_snapshots_state_check CHECK ((state = ANY (ARRAY['untracked'::text, 'on_track'::text, 'at_risk'::text, 'breached'::text, 'paused'::text])))
);


ALTER TABLE public.ticket_sla_snapshots OWNER TO paperclip;

--
-- Name: ticket_updates; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.ticket_updates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    actor_type text NOT NULL,
    actor_id text NOT NULL,
    update_type text NOT NULL,
    content text NOT NULL,
    metadata_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ticket_updates_actor_type_check CHECK ((actor_type = ANY (ARRAY['agent'::text, 'user'::text]))),
    CONSTRAINT ticket_updates_update_type_check CHECK ((update_type = ANY (ARRAY['comment'::text, 'status_change'::text, 'structured_update'::text])))
);


ALTER TABLE public.ticket_updates OWNER TO paperclip;

--
-- Name: tickets; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    creator_id text NOT NULL,
    status text NOT NULL,
    priority text NOT NULL,
    sla_state text DEFAULT 'untracked'::text NOT NULL,
    due_date timestamp with time zone,
    resolved_at timestamp with time zone,
    tags_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    parent_id uuid,
    CONSTRAINT tickets_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text]))),
    CONSTRAINT tickets_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'blocked'::text, 'cancelled'::text])))
);


ALTER TABLE public.tickets OWNER TO paperclip;

--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.user_profiles (
    user_id text NOT NULL,
    display_name text,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.user_profiles OWNER TO paperclip;

--
-- Name: workflow_imported_templates; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.workflow_imported_templates (
    id text NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    version text NOT NULL,
    template_definition jsonb NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    imported_by text
);


ALTER TABLE public.workflow_imported_templates OWNER TO paperclip;

--
-- Name: workflow_queue_jobs; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.workflow_queue_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    template_id text NOT NULL,
    attempt integer DEFAULT 1 NOT NULL,
    status text NOT NULL,
    error text,
    enqueued_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workflow_queue_jobs_attempt_check CHECK ((attempt > 0)),
    CONSTRAINT workflow_queue_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'retrying'::text, 'completed'::text, 'failed'::text])))
);


ALTER TABLE public.workflow_queue_jobs OWNER TO paperclip;

--
-- Name: workflow_runs; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.workflow_runs (
    id uuid NOT NULL,
    template_id text NOT NULL,
    template_name text NOT NULL,
    user_id text,
    status text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    input_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    output_json jsonb,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    runtime_state_json jsonb,
    CONSTRAINT workflow_runs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'escalated'::text, 'awaiting_approval'::text])))
);


ALTER TABLE public.workflow_runs OWNER TO paperclip;

--
-- Name: workflow_step_results; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.workflow_step_results (
    run_id uuid NOT NULL,
    step_id text NOT NULL,
    step_name text NOT NULL,
    status text NOT NULL,
    output_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    duration_ms integer DEFAULT 0 NOT NULL,
    error text,
    agent_slot_results_json jsonb,
    cost_log_json jsonb,
    ordinal integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workflow_step_results_status_check CHECK ((status = ANY (ARRAY['success'::text, 'failure'::text, 'skipped'::text, 'running'::text])))
);


ALTER TABLE public.workflow_step_results OWNER TO paperclip;

--
-- Name: workspace_members; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.workspace_members (
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])))
);


ALTER TABLE public.workspace_members OWNER TO paperclip;

--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: paperclip
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    owner_user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.workspaces OWNER TO paperclip;

--
-- Name: events_20260503; Type: TABLE ATTACH; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events ATTACH PARTITION observability.events_20260503 FOR VALUES FROM ('2026-05-03 00:00:00-04') TO ('2026-05-04 00:00:00-04');


--
-- Name: events_20260504; Type: TABLE ATTACH; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events ATTACH PARTITION observability.events_20260504 FOR VALUES FROM ('2026-05-04 00:00:00-04') TO ('2026-05-05 00:00:00-04');


--
-- Name: events_20260505; Type: TABLE ATTACH; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events ATTACH PARTITION observability.events_20260505 FOR VALUES FROM ('2026-05-05 00:00:00-04') TO ('2026-05-06 00:00:00-04');


--
-- Name: events_20260506; Type: TABLE ATTACH; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events ATTACH PARTITION observability.events_20260506 FOR VALUES FROM ('2026-05-06 00:00:00-04') TO ('2026-05-07 00:00:00-04');


--
-- Name: events_20260507; Type: TABLE ATTACH; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events ATTACH PARTITION observability.events_20260507 FOR VALUES FROM ('2026-05-07 00:00:00-04') TO ('2026-05-08 00:00:00-04');


--
-- Name: events_20260508; Type: TABLE ATTACH; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events ATTACH PARTITION observability.events_20260508 FOR VALUES FROM ('2026-05-08 00:00:00-04') TO ('2026-05-09 00:00:00-04');


--
-- Name: events_20260509; Type: TABLE ATTACH; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events ATTACH PARTITION observability.events_20260509 FOR VALUES FROM ('2026-05-09 00:00:00-04') TO ('2026-05-10 00:00:00-04');


--
-- Name: events_20260510; Type: TABLE ATTACH; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events ATTACH PARTITION observability.events_20260510 FOR VALUES FROM ('2026-05-10 00:00:00-04') TO ('2026-05-11 00:00:00-04');


--
-- Name: events_20260511; Type: TABLE ATTACH; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events ATTACH PARTITION observability.events_20260511 FOR VALUES FROM ('2026-05-11 00:00:00-04') TO ('2026-05-12 00:00:00-04');


--
-- Name: events_20260512; Type: TABLE ATTACH; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events ATTACH PARTITION observability.events_20260512 FOR VALUES FROM ('2026-05-12 00:00:00-04') TO ('2026-05-13 00:00:00-04');


--
-- Name: events_20260513; Type: TABLE ATTACH; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events ATTACH PARTITION observability.events_20260513 FOR VALUES FROM ('2026-05-13 00:00:00-04') TO ('2026-05-14 00:00:00-04');


--
-- Name: events_20260514; Type: TABLE ATTACH; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events ATTACH PARTITION observability.events_20260514 FOR VALUES FROM ('2026-05-14 00:00:00-04') TO ('2026-05-15 00:00:00-04');


--
-- Name: events_20260515; Type: TABLE ATTACH; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events ATTACH PARTITION observability.events_20260515 FOR VALUES FROM ('2026-05-15 00:00:00-04') TO ('2026-05-16 00:00:00-04');


--
-- Name: events_20260516; Type: TABLE ATTACH; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events ATTACH PARTITION observability.events_20260516 FOR VALUES FROM ('2026-05-16 00:00:00-04') TO ('2026-05-17 00:00:00-04');


--
-- Name: events_20260517; Type: TABLE ATTACH; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events ATTACH PARTITION observability.events_20260517 FOR VALUES FROM ('2026-05-17 00:00:00-04') TO ('2026-05-18 00:00:00-04');


--
-- Name: events_default; Type: TABLE ATTACH; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events ATTACH PARTITION observability.events_default DEFAULT;


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (occurred_at, id);


--
-- Name: events_20260503 events_20260503_pkey; Type: CONSTRAINT; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events_20260503
    ADD CONSTRAINT events_20260503_pkey PRIMARY KEY (occurred_at, id);


--
-- Name: events_20260504 events_20260504_pkey; Type: CONSTRAINT; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events_20260504
    ADD CONSTRAINT events_20260504_pkey PRIMARY KEY (occurred_at, id);


--
-- Name: events_20260505 events_20260505_pkey; Type: CONSTRAINT; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events_20260505
    ADD CONSTRAINT events_20260505_pkey PRIMARY KEY (occurred_at, id);


--
-- Name: events_20260506 events_20260506_pkey; Type: CONSTRAINT; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events_20260506
    ADD CONSTRAINT events_20260506_pkey PRIMARY KEY (occurred_at, id);


--
-- Name: events_20260507 events_20260507_pkey; Type: CONSTRAINT; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events_20260507
    ADD CONSTRAINT events_20260507_pkey PRIMARY KEY (occurred_at, id);


--
-- Name: events_20260508 events_20260508_pkey; Type: CONSTRAINT; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events_20260508
    ADD CONSTRAINT events_20260508_pkey PRIMARY KEY (occurred_at, id);


--
-- Name: events_20260509 events_20260509_pkey; Type: CONSTRAINT; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events_20260509
    ADD CONSTRAINT events_20260509_pkey PRIMARY KEY (occurred_at, id);


--
-- Name: events_20260510 events_20260510_pkey; Type: CONSTRAINT; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events_20260510
    ADD CONSTRAINT events_20260510_pkey PRIMARY KEY (occurred_at, id);


--
-- Name: events_20260511 events_20260511_pkey; Type: CONSTRAINT; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events_20260511
    ADD CONSTRAINT events_20260511_pkey PRIMARY KEY (occurred_at, id);


--
-- Name: events_20260512 events_20260512_pkey; Type: CONSTRAINT; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events_20260512
    ADD CONSTRAINT events_20260512_pkey PRIMARY KEY (occurred_at, id);


--
-- Name: events_20260513 events_20260513_pkey; Type: CONSTRAINT; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events_20260513
    ADD CONSTRAINT events_20260513_pkey PRIMARY KEY (occurred_at, id);


--
-- Name: events_20260514 events_20260514_pkey; Type: CONSTRAINT; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events_20260514
    ADD CONSTRAINT events_20260514_pkey PRIMARY KEY (occurred_at, id);


--
-- Name: events_20260515 events_20260515_pkey; Type: CONSTRAINT; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events_20260515
    ADD CONSTRAINT events_20260515_pkey PRIMARY KEY (occurred_at, id);


--
-- Name: events_20260516 events_20260516_pkey; Type: CONSTRAINT; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events_20260516
    ADD CONSTRAINT events_20260516_pkey PRIMARY KEY (occurred_at, id);


--
-- Name: events_20260517 events_20260517_pkey; Type: CONSTRAINT; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events_20260517
    ADD CONSTRAINT events_20260517_pkey PRIMARY KEY (occurred_at, id);


--
-- Name: events_default events_default_pkey; Type: CONSTRAINT; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.events_default
    ADD CONSTRAINT events_default_pkey PRIMARY KEY (occurred_at, id);


--
-- Name: rollups_15m rollups_15m_pkey; Type: CONSTRAINT; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.rollups_15m
    ADD CONSTRAINT rollups_15m_pkey PRIMARY KEY (bucket_start, workspace_id, source, event_type, status);


--
-- Name: rollups_daily rollups_daily_pkey; Type: CONSTRAINT; Schema: observability; Owner: paperclip
--

ALTER TABLE ONLY observability.rollups_daily
    ADD CONSTRAINT rollups_daily_pkey PRIMARY KEY (bucket_date, workspace_id, source, event_type, status);


--
-- Name: agent_heartbeat_logs agent_heartbeat_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.agent_heartbeat_logs
    ADD CONSTRAINT agent_heartbeat_logs_pkey PRIMARY KEY (id);


--
-- Name: agent_memory_entries agent_memory_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.agent_memory_entries
    ADD CONSTRAINT agent_memory_entries_pkey PRIMARY KEY (id);


--
-- Name: agent_memory_events agent_memory_events_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.agent_memory_events
    ADD CONSTRAINT agent_memory_events_pkey PRIMARY KEY (id);


--
-- Name: agent_memory_kg_facts agent_memory_kg_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.agent_memory_kg_facts
    ADD CONSTRAINT agent_memory_kg_facts_pkey PRIMARY KEY (id);


--
-- Name: approval_notifications approval_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.approval_notifications
    ADD CONSTRAINT approval_notifications_pkey PRIMARY KEY (id);


--
-- Name: approval_requests approval_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_pkey PRIMARY KEY (id);


--
-- Name: approval_tier_policies approval_tier_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.approval_tier_policies
    ADD CONSTRAINT approval_tier_policies_pkey PRIMARY KEY (id);


--
-- Name: approval_tier_policies approval_tier_policies_workspace_id_action_type_key; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.approval_tier_policies
    ADD CONSTRAINT approval_tier_policies_workspace_id_action_type_key UNIQUE (workspace_id, action_type);


--
-- Name: campaigns campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);


--
-- Name: connector_credentials connector_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.connector_credentials
    ADD CONSTRAINT connector_credentials_pkey PRIMARY KEY (service, id);


--
-- Name: control_plane_agents control_plane_agents_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_agents
    ADD CONSTRAINT control_plane_agents_pkey PRIMARY KEY (id);


--
-- Name: control_plane_audit_log control_plane_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_audit_log
    ADD CONSTRAINT control_plane_audit_log_pkey PRIMARY KEY (id);


--
-- Name: control_plane_budget_alerts control_plane_budget_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_budget_alerts
    ADD CONSTRAINT control_plane_budget_alerts_pkey PRIMARY KEY (id);


--
-- Name: control_plane_company_lifecycle_audit control_plane_company_lifecycle_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_company_lifecycle_audit
    ADD CONSTRAINT control_plane_company_lifecycle_audit_pkey PRIMARY KEY (id);


--
-- Name: control_plane_company_lifecycle control_plane_company_lifecycle_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_company_lifecycle
    ADD CONSTRAINT control_plane_company_lifecycle_pkey PRIMARY KEY (user_id);


--
-- Name: control_plane_executions control_plane_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_executions
    ADD CONSTRAINT control_plane_executions_pkey PRIMARY KEY (id);


--
-- Name: control_plane_heartbeats control_plane_heartbeats_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_heartbeats
    ADD CONSTRAINT control_plane_heartbeats_pkey PRIMARY KEY (id);


--
-- Name: control_plane_secret_audit control_plane_secret_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_secret_audit
    ADD CONSTRAINT control_plane_secret_audit_pkey PRIMARY KEY (id);


--
-- Name: control_plane_spend_entries control_plane_spend_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_spend_entries
    ADD CONSTRAINT control_plane_spend_entries_pkey PRIMARY KEY (id);


--
-- Name: control_plane_tasks control_plane_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_tasks
    ADD CONSTRAINT control_plane_tasks_pkey PRIMARY KEY (id);


--
-- Name: control_plane_teams control_plane_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_teams
    ADD CONSTRAINT control_plane_teams_pkey PRIMARY KEY (id);


--
-- Name: email_sends email_sends_campaign_id_lead_id_step_number_key; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.email_sends
    ADD CONSTRAINT email_sends_campaign_id_lead_id_step_number_key UNIQUE (campaign_id, lead_id, step_number);


--
-- Name: email_sends email_sends_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.email_sends
    ADD CONSTRAINT email_sends_pkey PRIMARY KEY (id);


--
-- Name: generated_reports generated_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.generated_reports
    ADD CONSTRAINT generated_reports_pkey PRIMARY KEY (id);


--
-- Name: icp_profiles icp_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.icp_profiles
    ADD CONSTRAINT icp_profiles_pkey PRIMARY KEY (id);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: llm_configs llm_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.llm_configs
    ADD CONSTRAINT llm_configs_pkey PRIMARY KEY (id);


--
-- Name: memory_entries memory_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.memory_entries
    ADD CONSTRAINT memory_entries_pkey PRIMARY KEY (id);


--
-- Name: notification_channel_configs notification_channel_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.notification_channel_configs
    ADD CONSTRAINT notification_channel_configs_pkey PRIMARY KEY (id);


--
-- Name: notification_channel_configs notification_channel_configs_workspace_id_channel_key; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.notification_channel_configs
    ADD CONSTRAINT notification_channel_configs_workspace_id_channel_key UNIQUE (workspace_id, channel);


--
-- Name: notification_deliveries notification_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_pkey PRIMARY KEY (id);


--
-- Name: notification_events notification_events_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.notification_events
    ADD CONSTRAINT notification_events_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_workspace_id_channel_kind_key; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_workspace_id_channel_kind_key UNIQUE (workspace_id, channel, kind);


--
-- Name: observability_events observability_events_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.observability_events
    ADD CONSTRAINT observability_events_pkey PRIMARY KEY (event_id);


--
-- Name: observability_events observability_events_sequence_key; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.observability_events
    ADD CONSTRAINT observability_events_sequence_key UNIQUE (sequence);


--
-- Name: provisioned_companies provisioned_companies_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.provisioned_companies
    ADD CONSTRAINT provisioned_companies_pkey PRIMARY KEY (id);


--
-- Name: provisioned_companies provisioned_companies_provisioned_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.provisioned_companies
    ADD CONSTRAINT provisioned_companies_provisioned_workspace_id_key UNIQUE (provisioned_workspace_id);


--
-- Name: provisioned_companies provisioned_companies_workspace_id_user_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.provisioned_companies
    ADD CONSTRAINT provisioned_companies_workspace_id_user_id_idempotency_key_key UNIQUE (workspace_id, user_id, idempotency_key);


--
-- Name: provisioned_company_secrets provisioned_company_secrets_company_id_key_key; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.provisioned_company_secrets
    ADD CONSTRAINT provisioned_company_secrets_company_id_key_key UNIQUE (company_id, key);


--
-- Name: provisioned_company_secrets provisioned_company_secrets_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.provisioned_company_secrets
    ADD CONSTRAINT provisioned_company_secrets_pkey PRIMARY KEY (id);


--
-- Name: social_auth_users social_auth_users_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.social_auth_users
    ADD CONSTRAINT social_auth_users_pkey PRIMARY KEY (id);


--
-- Name: social_auth_users social_auth_users_provider_provider_user_id_key; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.social_auth_users
    ADD CONSTRAINT social_auth_users_provider_provider_user_id_key UNIQUE (provider, provider_user_id);


--
-- Name: ticket_assignments ticket_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.ticket_assignments
    ADD CONSTRAINT ticket_assignments_pkey PRIMARY KEY (id);


--
-- Name: ticket_assignments ticket_assignments_ticket_id_actor_type_actor_id_key; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.ticket_assignments
    ADD CONSTRAINT ticket_assignments_ticket_id_actor_type_actor_id_key UNIQUE (ticket_id, actor_type, actor_id);


--
-- Name: ticket_notifications ticket_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.ticket_notifications
    ADD CONSTRAINT ticket_notifications_pkey PRIMARY KEY (id);


--
-- Name: ticket_sla_policies ticket_sla_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.ticket_sla_policies
    ADD CONSTRAINT ticket_sla_policies_pkey PRIMARY KEY (id);


--
-- Name: ticket_sla_policies ticket_sla_policies_workspace_id_priority_key; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.ticket_sla_policies
    ADD CONSTRAINT ticket_sla_policies_workspace_id_priority_key UNIQUE (workspace_id, priority);


--
-- Name: ticket_sla_snapshots ticket_sla_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.ticket_sla_snapshots
    ADD CONSTRAINT ticket_sla_snapshots_pkey PRIMARY KEY (ticket_id);


--
-- Name: ticket_updates ticket_updates_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.ticket_updates
    ADD CONSTRAINT ticket_updates_pkey PRIMARY KEY (id);


--
-- Name: tickets tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_pkey PRIMARY KEY (id);


--
-- Name: user_profiles user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: workflow_imported_templates workflow_imported_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.workflow_imported_templates
    ADD CONSTRAINT workflow_imported_templates_pkey PRIMARY KEY (id);


--
-- Name: workflow_queue_jobs workflow_queue_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.workflow_queue_jobs
    ADD CONSTRAINT workflow_queue_jobs_pkey PRIMARY KEY (id);


--
-- Name: workflow_queue_jobs workflow_queue_jobs_run_id_attempt_key; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.workflow_queue_jobs
    ADD CONSTRAINT workflow_queue_jobs_run_id_attempt_key UNIQUE (run_id, attempt);


--
-- Name: workflow_runs workflow_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT workflow_runs_pkey PRIMARY KEY (id);


--
-- Name: workflow_step_results workflow_step_results_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.workflow_step_results
    ADD CONSTRAINT workflow_step_results_pkey PRIMARY KEY (run_id, step_id, ordinal);


--
-- Name: workspace_members workspace_members_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (workspace_id, user_id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: idx_observability_events_type_time; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX idx_observability_events_type_time ON ONLY observability.events USING btree (event_type, occurred_at DESC);


--
-- Name: events_20260503_event_type_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260503_event_type_occurred_at_idx ON observability.events_20260503 USING btree (event_type, occurred_at DESC);


--
-- Name: idx_observability_events_source_time; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX idx_observability_events_source_time ON ONLY observability.events USING btree (source, occurred_at DESC);


--
-- Name: events_20260503_source_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260503_source_occurred_at_idx ON observability.events_20260503 USING btree (source, occurred_at DESC);


--
-- Name: idx_observability_events_workspace_time; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX idx_observability_events_workspace_time ON ONLY observability.events USING btree (workspace_id, occurred_at DESC);


--
-- Name: events_20260503_workspace_id_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260503_workspace_id_occurred_at_idx ON observability.events_20260503 USING btree (workspace_id, occurred_at DESC);


--
-- Name: events_20260504_event_type_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260504_event_type_occurred_at_idx ON observability.events_20260504 USING btree (event_type, occurred_at DESC);


--
-- Name: events_20260504_source_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260504_source_occurred_at_idx ON observability.events_20260504 USING btree (source, occurred_at DESC);


--
-- Name: events_20260504_workspace_id_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260504_workspace_id_occurred_at_idx ON observability.events_20260504 USING btree (workspace_id, occurred_at DESC);


--
-- Name: events_20260505_event_type_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260505_event_type_occurred_at_idx ON observability.events_20260505 USING btree (event_type, occurred_at DESC);


--
-- Name: events_20260505_source_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260505_source_occurred_at_idx ON observability.events_20260505 USING btree (source, occurred_at DESC);


--
-- Name: events_20260505_workspace_id_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260505_workspace_id_occurred_at_idx ON observability.events_20260505 USING btree (workspace_id, occurred_at DESC);


--
-- Name: events_20260506_event_type_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260506_event_type_occurred_at_idx ON observability.events_20260506 USING btree (event_type, occurred_at DESC);


--
-- Name: events_20260506_source_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260506_source_occurred_at_idx ON observability.events_20260506 USING btree (source, occurred_at DESC);


--
-- Name: events_20260506_workspace_id_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260506_workspace_id_occurred_at_idx ON observability.events_20260506 USING btree (workspace_id, occurred_at DESC);


--
-- Name: events_20260507_event_type_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260507_event_type_occurred_at_idx ON observability.events_20260507 USING btree (event_type, occurred_at DESC);


--
-- Name: events_20260507_source_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260507_source_occurred_at_idx ON observability.events_20260507 USING btree (source, occurred_at DESC);


--
-- Name: events_20260507_workspace_id_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260507_workspace_id_occurred_at_idx ON observability.events_20260507 USING btree (workspace_id, occurred_at DESC);


--
-- Name: events_20260508_event_type_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260508_event_type_occurred_at_idx ON observability.events_20260508 USING btree (event_type, occurred_at DESC);


--
-- Name: events_20260508_source_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260508_source_occurred_at_idx ON observability.events_20260508 USING btree (source, occurred_at DESC);


--
-- Name: events_20260508_workspace_id_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260508_workspace_id_occurred_at_idx ON observability.events_20260508 USING btree (workspace_id, occurred_at DESC);


--
-- Name: events_20260509_event_type_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260509_event_type_occurred_at_idx ON observability.events_20260509 USING btree (event_type, occurred_at DESC);


--
-- Name: events_20260509_source_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260509_source_occurred_at_idx ON observability.events_20260509 USING btree (source, occurred_at DESC);


--
-- Name: events_20260509_workspace_id_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260509_workspace_id_occurred_at_idx ON observability.events_20260509 USING btree (workspace_id, occurred_at DESC);


--
-- Name: events_20260510_event_type_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260510_event_type_occurred_at_idx ON observability.events_20260510 USING btree (event_type, occurred_at DESC);


--
-- Name: events_20260510_source_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260510_source_occurred_at_idx ON observability.events_20260510 USING btree (source, occurred_at DESC);


--
-- Name: events_20260510_workspace_id_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260510_workspace_id_occurred_at_idx ON observability.events_20260510 USING btree (workspace_id, occurred_at DESC);


--
-- Name: events_20260511_event_type_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260511_event_type_occurred_at_idx ON observability.events_20260511 USING btree (event_type, occurred_at DESC);


--
-- Name: events_20260511_source_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260511_source_occurred_at_idx ON observability.events_20260511 USING btree (source, occurred_at DESC);


--
-- Name: events_20260511_workspace_id_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260511_workspace_id_occurred_at_idx ON observability.events_20260511 USING btree (workspace_id, occurred_at DESC);


--
-- Name: events_20260512_event_type_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260512_event_type_occurred_at_idx ON observability.events_20260512 USING btree (event_type, occurred_at DESC);


--
-- Name: events_20260512_source_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260512_source_occurred_at_idx ON observability.events_20260512 USING btree (source, occurred_at DESC);


--
-- Name: events_20260512_workspace_id_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260512_workspace_id_occurred_at_idx ON observability.events_20260512 USING btree (workspace_id, occurred_at DESC);


--
-- Name: events_20260513_event_type_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260513_event_type_occurred_at_idx ON observability.events_20260513 USING btree (event_type, occurred_at DESC);


--
-- Name: events_20260513_source_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260513_source_occurred_at_idx ON observability.events_20260513 USING btree (source, occurred_at DESC);


--
-- Name: events_20260513_workspace_id_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260513_workspace_id_occurred_at_idx ON observability.events_20260513 USING btree (workspace_id, occurred_at DESC);


--
-- Name: events_20260514_event_type_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260514_event_type_occurred_at_idx ON observability.events_20260514 USING btree (event_type, occurred_at DESC);


--
-- Name: events_20260514_source_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260514_source_occurred_at_idx ON observability.events_20260514 USING btree (source, occurred_at DESC);


--
-- Name: events_20260514_workspace_id_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260514_workspace_id_occurred_at_idx ON observability.events_20260514 USING btree (workspace_id, occurred_at DESC);


--
-- Name: events_20260515_event_type_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260515_event_type_occurred_at_idx ON observability.events_20260515 USING btree (event_type, occurred_at DESC);


--
-- Name: events_20260515_source_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260515_source_occurred_at_idx ON observability.events_20260515 USING btree (source, occurred_at DESC);


--
-- Name: events_20260515_workspace_id_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260515_workspace_id_occurred_at_idx ON observability.events_20260515 USING btree (workspace_id, occurred_at DESC);


--
-- Name: events_20260516_event_type_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260516_event_type_occurred_at_idx ON observability.events_20260516 USING btree (event_type, occurred_at DESC);


--
-- Name: events_20260516_source_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260516_source_occurred_at_idx ON observability.events_20260516 USING btree (source, occurred_at DESC);


--
-- Name: events_20260516_workspace_id_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260516_workspace_id_occurred_at_idx ON observability.events_20260516 USING btree (workspace_id, occurred_at DESC);


--
-- Name: events_20260517_event_type_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260517_event_type_occurred_at_idx ON observability.events_20260517 USING btree (event_type, occurred_at DESC);


--
-- Name: events_20260517_source_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260517_source_occurred_at_idx ON observability.events_20260517 USING btree (source, occurred_at DESC);


--
-- Name: events_20260517_workspace_id_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_20260517_workspace_id_occurred_at_idx ON observability.events_20260517 USING btree (workspace_id, occurred_at DESC);


--
-- Name: events_default_event_type_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_default_event_type_occurred_at_idx ON observability.events_default USING btree (event_type, occurred_at DESC);


--
-- Name: events_default_source_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_default_source_occurred_at_idx ON observability.events_default USING btree (source, occurred_at DESC);


--
-- Name: events_default_workspace_id_occurred_at_idx; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX events_default_workspace_id_occurred_at_idx ON observability.events_default USING btree (workspace_id, occurred_at DESC);


--
-- Name: idx_observability_rollups_15m_bucket; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX idx_observability_rollups_15m_bucket ON observability.rollups_15m USING btree (bucket_start DESC);


--
-- Name: idx_observability_rollups_daily_bucket; Type: INDEX; Schema: observability; Owner: paperclip
--

CREATE INDEX idx_observability_rollups_daily_bucket ON observability.rollups_daily USING btree (bucket_date DESC);


--
-- Name: idx_agent_heartbeat_logs_expires_at; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_agent_heartbeat_logs_expires_at ON public.agent_heartbeat_logs USING btree (expires_at);


--
-- Name: idx_agent_heartbeat_logs_run_id; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_agent_heartbeat_logs_run_id ON public.agent_heartbeat_logs USING btree (run_id);


--
-- Name: idx_agent_heartbeat_logs_user_agent; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_agent_heartbeat_logs_user_agent ON public.agent_heartbeat_logs USING btree (user_id, agent_id, created_at DESC);


--
-- Name: idx_agent_heartbeat_logs_workspace_layer; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_agent_heartbeat_logs_workspace_layer ON public.agent_heartbeat_logs USING btree (user_id, workspace_id, memory_layer, created_at DESC);


--
-- Name: idx_agent_memory_entries_expires_at; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_agent_memory_entries_expires_at ON public.agent_memory_entries USING btree (expires_at);


--
-- Name: idx_agent_memory_entries_user_agent; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_agent_memory_entries_user_agent ON public.agent_memory_entries USING btree (user_id, agent_id, updated_at DESC);


--
-- Name: idx_agent_memory_entries_user_agent_type; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_agent_memory_entries_user_agent_type ON public.agent_memory_entries USING btree (user_id, agent_id, entry_type, updated_at DESC);


--
-- Name: idx_agent_memory_entries_user_scope; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_agent_memory_entries_user_scope ON public.agent_memory_entries USING btree (user_id, scope, updated_at DESC);


--
-- Name: idx_agent_memory_entries_workspace_layer; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_agent_memory_entries_workspace_layer ON public.agent_memory_entries USING btree (user_id, workspace_id, memory_layer, updated_at DESC);


--
-- Name: idx_agent_memory_events_workspace_created; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_agent_memory_events_workspace_created ON public.agent_memory_events USING btree (user_id, workspace_id, created_at DESC);


--
-- Name: idx_agent_memory_kg_facts_expires_at; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_agent_memory_kg_facts_expires_at ON public.agent_memory_kg_facts USING btree (expires_at);


--
-- Name: idx_agent_memory_kg_facts_user_agent; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_agent_memory_kg_facts_user_agent ON public.agent_memory_kg_facts USING btree (user_id, agent_id, created_at DESC);


--
-- Name: idx_agent_memory_kg_facts_user_scope; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_agent_memory_kg_facts_user_scope ON public.agent_memory_kg_facts USING btree (user_id, scope, created_at DESC);


--
-- Name: idx_agent_memory_kg_facts_workspace_layer; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_agent_memory_kg_facts_workspace_layer ON public.agent_memory_kg_facts USING btree (user_id, workspace_id, memory_layer, created_at DESC);


--
-- Name: idx_approval_notifications_approval_request_id; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_approval_notifications_approval_request_id ON public.approval_notifications USING btree (approval_request_id);


--
-- Name: idx_approval_notifications_status; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_approval_notifications_status ON public.approval_notifications USING btree (status);


--
-- Name: idx_approval_requests_run_id; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_approval_requests_run_id ON public.approval_requests USING btree (run_id);


--
-- Name: idx_approval_requests_status; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_approval_requests_status ON public.approval_requests USING btree (status);


--
-- Name: idx_campaigns_workspace_id; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_campaigns_workspace_id ON public.campaigns USING btree (workspace_id);


--
-- Name: idx_connector_credentials_service_revoked; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_connector_credentials_service_revoked ON public.connector_credentials USING btree (service, revoked_at);


--
-- Name: idx_connector_credentials_service_user; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_connector_credentials_service_user ON public.connector_credentials USING btree (service, user_id, created_at DESC);


--
-- Name: idx_control_plane_agents_team; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_agents_team ON public.control_plane_agents USING btree (team_id);


--
-- Name: idx_control_plane_agents_user; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_agents_user ON public.control_plane_agents USING btree (workspace_id, user_id);


--
-- Name: idx_control_plane_agents_workspace; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_agents_workspace ON public.control_plane_agents USING btree (workspace_id);


--
-- Name: idx_control_plane_audit_log_actor_agent; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_audit_log_actor_agent ON public.control_plane_audit_log USING btree (actor_agent_id, at DESC) WHERE (actor_agent_id IS NOT NULL);


--
-- Name: idx_control_plane_audit_log_actor_user; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_audit_log_actor_user ON public.control_plane_audit_log USING btree (actor_user_id, at DESC) WHERE (actor_user_id IS NOT NULL);


--
-- Name: idx_control_plane_audit_log_category_at; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_audit_log_category_at ON public.control_plane_audit_log USING btree (category, at DESC);


--
-- Name: idx_control_plane_audit_log_target; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_audit_log_target ON public.control_plane_audit_log USING btree (target_type, target_id) WHERE (target_type IS NOT NULL);


--
-- Name: idx_control_plane_audit_log_workspace_at; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_audit_log_workspace_at ON public.control_plane_audit_log USING btree (workspace_id, at DESC);


--
-- Name: idx_control_plane_budget_alerts_team_recorded; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_budget_alerts_team_recorded ON public.control_plane_budget_alerts USING btree (team_id, recorded_at DESC);


--
-- Name: idx_control_plane_budget_alerts_workspace; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_budget_alerts_workspace ON public.control_plane_budget_alerts USING btree (workspace_id);


--
-- Name: idx_control_plane_company_lifecycle_audit_user_created; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_company_lifecycle_audit_user_created ON public.control_plane_company_lifecycle_audit USING btree (user_id, created_at DESC);


--
-- Name: idx_control_plane_executions_agent; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_executions_agent ON public.control_plane_executions USING btree (agent_id);


--
-- Name: idx_control_plane_executions_team; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_executions_team ON public.control_plane_executions USING btree (team_id);


--
-- Name: idx_control_plane_executions_user_requested; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_executions_user_requested ON public.control_plane_executions USING btree (workspace_id, user_id, requested_at);


--
-- Name: idx_control_plane_executions_workspace; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_executions_workspace ON public.control_plane_executions USING btree (workspace_id);


--
-- Name: idx_control_plane_heartbeats_agent_started; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_heartbeats_agent_started ON public.control_plane_heartbeats USING btree (agent_id, started_at DESC);


--
-- Name: idx_control_plane_heartbeats_execution; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_heartbeats_execution ON public.control_plane_heartbeats USING btree (execution_id);


--
-- Name: idx_control_plane_heartbeats_team_started; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_heartbeats_team_started ON public.control_plane_heartbeats USING btree (team_id, started_at DESC);


--
-- Name: idx_control_plane_heartbeats_workspace; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_heartbeats_workspace ON public.control_plane_heartbeats USING btree (workspace_id);


--
-- Name: idx_control_plane_secret_audit_actor_agent; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_secret_audit_actor_agent ON public.control_plane_secret_audit USING btree (actor_agent_id) WHERE (actor_agent_id IS NOT NULL);


--
-- Name: idx_control_plane_secret_audit_actor_user; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_secret_audit_actor_user ON public.control_plane_secret_audit USING btree (actor_user_id) WHERE (actor_user_id IS NOT NULL);


--
-- Name: idx_control_plane_secret_audit_company_at; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_secret_audit_company_at ON public.control_plane_secret_audit USING btree (company_id, at DESC);


--
-- Name: idx_control_plane_secret_audit_workspace; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_secret_audit_workspace ON public.control_plane_secret_audit USING btree (workspace_id);


--
-- Name: idx_control_plane_spend_agent_recorded; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_spend_agent_recorded ON public.control_plane_spend_entries USING btree (agent_id, recorded_at DESC);


--
-- Name: idx_control_plane_spend_execution; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_spend_execution ON public.control_plane_spend_entries USING btree (execution_id);


--
-- Name: idx_control_plane_spend_team_recorded; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_spend_team_recorded ON public.control_plane_spend_entries USING btree (team_id, recorded_at DESC);


--
-- Name: idx_control_plane_spend_workspace; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_spend_workspace ON public.control_plane_spend_entries USING btree (workspace_id);


--
-- Name: idx_control_plane_tasks_agent; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_tasks_agent ON public.control_plane_tasks USING btree (assigned_agent_id);


--
-- Name: idx_control_plane_tasks_execution; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_tasks_execution ON public.control_plane_tasks USING btree (execution_id);


--
-- Name: idx_control_plane_tasks_user_team; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_tasks_user_team ON public.control_plane_tasks USING btree (workspace_id, user_id, team_id, created_at);


--
-- Name: idx_control_plane_tasks_workspace; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_tasks_workspace ON public.control_plane_tasks USING btree (workspace_id);


--
-- Name: idx_control_plane_teams_company; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_teams_company ON public.control_plane_teams USING btree (company_id);


--
-- Name: idx_control_plane_teams_user; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_teams_user ON public.control_plane_teams USING btree (workspace_id, user_id);


--
-- Name: idx_control_plane_teams_workspace; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_control_plane_teams_workspace ON public.control_plane_teams USING btree (workspace_id);


--
-- Name: idx_email_sends_campaign_id; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_email_sends_campaign_id ON public.email_sends USING btree (campaign_id);


--
-- Name: idx_email_sends_lead_id; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_email_sends_lead_id ON public.email_sends USING btree (lead_id);


--
-- Name: idx_email_sends_workspace_id; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_email_sends_workspace_id ON public.email_sends USING btree (workspace_id);


--
-- Name: idx_generated_reports_kind_created_at; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_generated_reports_kind_created_at ON public.generated_reports USING btree (kind, created_at DESC);


--
-- Name: idx_generated_reports_team_created_at; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_generated_reports_team_created_at ON public.generated_reports USING btree (team_id, created_at DESC);


--
-- Name: idx_generated_reports_user_created_at; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_generated_reports_user_created_at ON public.generated_reports USING btree (user_id, created_at DESC);


--
-- Name: idx_icp_profiles_workspace_id; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_icp_profiles_workspace_id ON public.icp_profiles USING btree (workspace_id);


--
-- Name: idx_leads_workspace_id; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_leads_workspace_id ON public.leads USING btree (workspace_id);


--
-- Name: idx_llm_configs_user_default; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE UNIQUE INDEX idx_llm_configs_user_default ON public.llm_configs USING btree (user_id) WHERE (is_default = true);


--
-- Name: idx_llm_configs_user_id; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_llm_configs_user_id ON public.llm_configs USING btree (user_id);


--
-- Name: idx_memory_entries_expires_at; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_memory_entries_expires_at ON public.memory_entries USING btree (expires_at);


--
-- Name: idx_memory_entries_scope_key; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_memory_entries_scope_key ON public.memory_entries USING btree (user_id, key, workflow_id, agent_id);


--
-- Name: idx_memory_entries_user_id; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_memory_entries_user_id ON public.memory_entries USING btree (user_id);


--
-- Name: idx_notification_deliveries_workspace_channel_cadence; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_notification_deliveries_workspace_channel_cadence ON public.notification_deliveries USING btree (workspace_id, channel, cadence, created_at DESC);


--
-- Name: idx_notification_events_workspace_kind_time; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_notification_events_workspace_kind_time ON public.notification_events USING btree (workspace_id, kind, occurred_at DESC);


--
-- Name: idx_observability_events_subject; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_observability_events_subject ON public.observability_events USING btree (subject_type, subject_id, sequence DESC);


--
-- Name: idx_observability_events_user_category_sequence; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_observability_events_user_category_sequence ON public.observability_events USING btree (user_id, category, sequence DESC);


--
-- Name: idx_observability_events_user_sequence; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_observability_events_user_sequence ON public.observability_events USING btree (user_id, sequence DESC);


--
-- Name: idx_provisioned_companies_user; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_provisioned_companies_user ON public.provisioned_companies USING btree (workspace_id, user_id);


--
-- Name: idx_provisioned_companies_workspace; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_provisioned_companies_workspace ON public.provisioned_companies USING btree (workspace_id);


--
-- Name: idx_provisioned_company_secrets_company; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_provisioned_company_secrets_company ON public.provisioned_company_secrets USING btree (company_id);


--
-- Name: idx_provisioned_company_secrets_workspace; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_provisioned_company_secrets_workspace ON public.provisioned_company_secrets USING btree (workspace_id);


--
-- Name: idx_social_auth_users_email; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_social_auth_users_email ON public.social_auth_users USING btree (email);


--
-- Name: idx_ticket_assignments_actor_lookup; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_ticket_assignments_actor_lookup ON public.ticket_assignments USING btree (actor_type, actor_id, role, ticket_id);


--
-- Name: idx_ticket_assignments_primary; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE UNIQUE INDEX idx_ticket_assignments_primary ON public.ticket_assignments USING btree (ticket_id) WHERE (role = 'primary'::text);


--
-- Name: idx_ticket_notifications_recipient; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_ticket_notifications_recipient ON public.ticket_notifications USING btree (recipient_type, recipient_id, created_at DESC);


--
-- Name: idx_ticket_sla_snapshots_workspace_state; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_ticket_sla_snapshots_workspace_state ON public.ticket_sla_snapshots USING btree (workspace_id, state, updated_at DESC);


--
-- Name: idx_ticket_updates_ticket_created; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_ticket_updates_ticket_created ON public.ticket_updates USING btree (ticket_id, created_at);


--
-- Name: idx_tickets_parent_id_created; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_tickets_parent_id_created ON public.tickets USING btree (parent_id, created_at DESC);


--
-- Name: idx_tickets_workspace_created; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_tickets_workspace_created ON public.tickets USING btree (workspace_id, created_at DESC);


--
-- Name: idx_tickets_workspace_status_priority; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_tickets_workspace_status_priority ON public.tickets USING btree (workspace_id, status, priority);


--
-- Name: idx_workflow_imported_templates_category; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_workflow_imported_templates_category ON public.workflow_imported_templates USING btree (category);


--
-- Name: idx_workflow_imported_templates_imported_at; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_workflow_imported_templates_imported_at ON public.workflow_imported_templates USING btree (imported_at DESC);


--
-- Name: idx_workflow_queue_jobs_run_id; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_workflow_queue_jobs_run_id ON public.workflow_queue_jobs USING btree (run_id);


--
-- Name: idx_workflow_queue_jobs_template_status; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_workflow_queue_jobs_template_status ON public.workflow_queue_jobs USING btree (template_id, status, enqueued_at);


--
-- Name: idx_workflow_runs_started_at; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_workflow_runs_started_at ON public.workflow_runs USING btree (started_at DESC);


--
-- Name: idx_workflow_runs_status; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_workflow_runs_status ON public.workflow_runs USING btree (status);


--
-- Name: idx_workflow_runs_template_id; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_workflow_runs_template_id ON public.workflow_runs USING btree (template_id);


--
-- Name: idx_workflow_step_results_run_ordinal; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_workflow_step_results_run_ordinal ON public.workflow_step_results USING btree (run_id, ordinal);


--
-- Name: idx_workspace_members_user_id; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE INDEX idx_workspace_members_user_id ON public.workspace_members USING btree (user_id);


--
-- Name: leads_workspace_email_key; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE UNIQUE INDEX leads_workspace_email_key ON public.leads USING btree (workspace_id, lower(email)) WHERE (email IS NOT NULL);


--
-- Name: uq_control_plane_budget_alerts_agent_scope; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE UNIQUE INDEX uq_control_plane_budget_alerts_agent_scope ON public.control_plane_budget_alerts USING btree (team_id, agent_id, threshold) WHERE ((scope = 'agent'::text) AND (agent_id IS NOT NULL));


--
-- Name: uq_control_plane_budget_alerts_team_scope; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE UNIQUE INDEX uq_control_plane_budget_alerts_team_scope ON public.control_plane_budget_alerts USING btree (team_id, threshold) WHERE (scope = 'team'::text);


--
-- Name: uq_control_plane_budget_alerts_tool_scope; Type: INDEX; Schema: public; Owner: paperclip
--

CREATE UNIQUE INDEX uq_control_plane_budget_alerts_tool_scope ON public.control_plane_budget_alerts USING btree (team_id, tool_name, threshold) WHERE ((scope = 'tool'::text) AND (tool_name IS NOT NULL));


--
-- Name: events_20260503_event_type_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_type_time ATTACH PARTITION observability.events_20260503_event_type_occurred_at_idx;


--
-- Name: events_20260503_pkey; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.events_pkey ATTACH PARTITION observability.events_20260503_pkey;


--
-- Name: events_20260503_source_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_source_time ATTACH PARTITION observability.events_20260503_source_occurred_at_idx;


--
-- Name: events_20260503_workspace_id_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_workspace_time ATTACH PARTITION observability.events_20260503_workspace_id_occurred_at_idx;


--
-- Name: events_20260504_event_type_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_type_time ATTACH PARTITION observability.events_20260504_event_type_occurred_at_idx;


--
-- Name: events_20260504_pkey; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.events_pkey ATTACH PARTITION observability.events_20260504_pkey;


--
-- Name: events_20260504_source_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_source_time ATTACH PARTITION observability.events_20260504_source_occurred_at_idx;


--
-- Name: events_20260504_workspace_id_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_workspace_time ATTACH PARTITION observability.events_20260504_workspace_id_occurred_at_idx;


--
-- Name: events_20260505_event_type_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_type_time ATTACH PARTITION observability.events_20260505_event_type_occurred_at_idx;


--
-- Name: events_20260505_pkey; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.events_pkey ATTACH PARTITION observability.events_20260505_pkey;


--
-- Name: events_20260505_source_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_source_time ATTACH PARTITION observability.events_20260505_source_occurred_at_idx;


--
-- Name: events_20260505_workspace_id_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_workspace_time ATTACH PARTITION observability.events_20260505_workspace_id_occurred_at_idx;


--
-- Name: events_20260506_event_type_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_type_time ATTACH PARTITION observability.events_20260506_event_type_occurred_at_idx;


--
-- Name: events_20260506_pkey; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.events_pkey ATTACH PARTITION observability.events_20260506_pkey;


--
-- Name: events_20260506_source_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_source_time ATTACH PARTITION observability.events_20260506_source_occurred_at_idx;


--
-- Name: events_20260506_workspace_id_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_workspace_time ATTACH PARTITION observability.events_20260506_workspace_id_occurred_at_idx;


--
-- Name: events_20260507_event_type_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_type_time ATTACH PARTITION observability.events_20260507_event_type_occurred_at_idx;


--
-- Name: events_20260507_pkey; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.events_pkey ATTACH PARTITION observability.events_20260507_pkey;


--
-- Name: events_20260507_source_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_source_time ATTACH PARTITION observability.events_20260507_source_occurred_at_idx;


--
-- Name: events_20260507_workspace_id_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_workspace_time ATTACH PARTITION observability.events_20260507_workspace_id_occurred_at_idx;


--
-- Name: events_20260508_event_type_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_type_time ATTACH PARTITION observability.events_20260508_event_type_occurred_at_idx;


--
-- Name: events_20260508_pkey; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.events_pkey ATTACH PARTITION observability.events_20260508_pkey;


--
-- Name: events_20260508_source_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_source_time ATTACH PARTITION observability.events_20260508_source_occurred_at_idx;


--
-- Name: events_20260508_workspace_id_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_workspace_time ATTACH PARTITION observability.events_20260508_workspace_id_occurred_at_idx;


--
-- Name: events_20260509_event_type_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_type_time ATTACH PARTITION observability.events_20260509_event_type_occurred_at_idx;


--
-- Name: events_20260509_pkey; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.events_pkey ATTACH PARTITION observability.events_20260509_pkey;


--
-- Name: events_20260509_source_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_source_time ATTACH PARTITION observability.events_20260509_source_occurred_at_idx;


--
-- Name: events_20260509_workspace_id_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_workspace_time ATTACH PARTITION observability.events_20260509_workspace_id_occurred_at_idx;


--
-- Name: events_20260510_event_type_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_type_time ATTACH PARTITION observability.events_20260510_event_type_occurred_at_idx;


--
-- Name: events_20260510_pkey; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.events_pkey ATTACH PARTITION observability.events_20260510_pkey;


--
-- Name: events_20260510_source_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_source_time ATTACH PARTITION observability.events_20260510_source_occurred_at_idx;


--
-- Name: events_20260510_workspace_id_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_workspace_time ATTACH PARTITION observability.events_20260510_workspace_id_occurred_at_idx;


--
-- Name: events_20260511_event_type_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_type_time ATTACH PARTITION observability.events_20260511_event_type_occurred_at_idx;


--
-- Name: events_20260511_pkey; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.events_pkey ATTACH PARTITION observability.events_20260511_pkey;


--
-- Name: events_20260511_source_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_source_time ATTACH PARTITION observability.events_20260511_source_occurred_at_idx;


--
-- Name: events_20260511_workspace_id_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_workspace_time ATTACH PARTITION observability.events_20260511_workspace_id_occurred_at_idx;


--
-- Name: events_20260512_event_type_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_type_time ATTACH PARTITION observability.events_20260512_event_type_occurred_at_idx;


--
-- Name: events_20260512_pkey; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.events_pkey ATTACH PARTITION observability.events_20260512_pkey;


--
-- Name: events_20260512_source_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_source_time ATTACH PARTITION observability.events_20260512_source_occurred_at_idx;


--
-- Name: events_20260512_workspace_id_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_workspace_time ATTACH PARTITION observability.events_20260512_workspace_id_occurred_at_idx;


--
-- Name: events_20260513_event_type_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_type_time ATTACH PARTITION observability.events_20260513_event_type_occurred_at_idx;


--
-- Name: events_20260513_pkey; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.events_pkey ATTACH PARTITION observability.events_20260513_pkey;


--
-- Name: events_20260513_source_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_source_time ATTACH PARTITION observability.events_20260513_source_occurred_at_idx;


--
-- Name: events_20260513_workspace_id_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_workspace_time ATTACH PARTITION observability.events_20260513_workspace_id_occurred_at_idx;


--
-- Name: events_20260514_event_type_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_type_time ATTACH PARTITION observability.events_20260514_event_type_occurred_at_idx;


--
-- Name: events_20260514_pkey; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.events_pkey ATTACH PARTITION observability.events_20260514_pkey;


--
-- Name: events_20260514_source_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_source_time ATTACH PARTITION observability.events_20260514_source_occurred_at_idx;


--
-- Name: events_20260514_workspace_id_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_workspace_time ATTACH PARTITION observability.events_20260514_workspace_id_occurred_at_idx;


--
-- Name: events_20260515_event_type_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_type_time ATTACH PARTITION observability.events_20260515_event_type_occurred_at_idx;


--
-- Name: events_20260515_pkey; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.events_pkey ATTACH PARTITION observability.events_20260515_pkey;


--
-- Name: events_20260515_source_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_source_time ATTACH PARTITION observability.events_20260515_source_occurred_at_idx;


--
-- Name: events_20260515_workspace_id_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_workspace_time ATTACH PARTITION observability.events_20260515_workspace_id_occurred_at_idx;


--
-- Name: events_20260516_event_type_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_type_time ATTACH PARTITION observability.events_20260516_event_type_occurred_at_idx;


--
-- Name: events_20260516_pkey; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.events_pkey ATTACH PARTITION observability.events_20260516_pkey;


--
-- Name: events_20260516_source_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_source_time ATTACH PARTITION observability.events_20260516_source_occurred_at_idx;


--
-- Name: events_20260516_workspace_id_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_workspace_time ATTACH PARTITION observability.events_20260516_workspace_id_occurred_at_idx;


--
-- Name: events_20260517_event_type_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_type_time ATTACH PARTITION observability.events_20260517_event_type_occurred_at_idx;


--
-- Name: events_20260517_pkey; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.events_pkey ATTACH PARTITION observability.events_20260517_pkey;


--
-- Name: events_20260517_source_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_source_time ATTACH PARTITION observability.events_20260517_source_occurred_at_idx;


--
-- Name: events_20260517_workspace_id_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_workspace_time ATTACH PARTITION observability.events_20260517_workspace_id_occurred_at_idx;


--
-- Name: events_default_event_type_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_type_time ATTACH PARTITION observability.events_default_event_type_occurred_at_idx;


--
-- Name: events_default_pkey; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.events_pkey ATTACH PARTITION observability.events_default_pkey;


--
-- Name: events_default_source_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_source_time ATTACH PARTITION observability.events_default_source_occurred_at_idx;


--
-- Name: events_default_workspace_id_occurred_at_idx; Type: INDEX ATTACH; Schema: observability; Owner: paperclip
--

ALTER INDEX observability.idx_observability_events_workspace_time ATTACH PARTITION observability.events_default_workspace_id_occurred_at_idx;


--
-- Name: email_sends trg_email_sends_workspace_match; Type: TRIGGER; Schema: public; Owner: paperclip
--

CREATE TRIGGER trg_email_sends_workspace_match BEFORE INSERT OR UPDATE ON public.email_sends FOR EACH ROW EXECUTE FUNCTION public.enforce_email_send_workspace_match();


--
-- Name: approval_notifications approval_notifications_approval_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.approval_notifications
    ADD CONSTRAINT approval_notifications_approval_request_id_fkey FOREIGN KEY (approval_request_id) REFERENCES public.approval_requests(id) ON DELETE CASCADE;


--
-- Name: approval_notifications approval_notifications_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.approval_notifications
    ADD CONSTRAINT approval_notifications_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.workflow_runs(id) ON DELETE CASCADE;


--
-- Name: approval_requests approval_requests_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.workflow_runs(id) ON DELETE CASCADE;


--
-- Name: approval_tier_policies approval_tier_policies_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.approval_tier_policies
    ADD CONSTRAINT approval_tier_policies_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: campaigns campaigns_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: control_plane_agents control_plane_agents_current_execution_fk; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_agents
    ADD CONSTRAINT control_plane_agents_current_execution_fk FOREIGN KEY (current_execution_id) REFERENCES public.control_plane_executions(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;


--
-- Name: control_plane_agents control_plane_agents_reporting_to_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_agents
    ADD CONSTRAINT control_plane_agents_reporting_to_agent_id_fkey FOREIGN KEY (reporting_to_agent_id) REFERENCES public.control_plane_agents(id) ON DELETE SET NULL;


--
-- Name: control_plane_agents control_plane_agents_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_agents
    ADD CONSTRAINT control_plane_agents_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.control_plane_teams(id) ON DELETE CASCADE;


--
-- Name: control_plane_agents control_plane_agents_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_agents
    ADD CONSTRAINT control_plane_agents_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: control_plane_audit_log control_plane_audit_log_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_audit_log
    ADD CONSTRAINT control_plane_audit_log_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: control_plane_budget_alerts control_plane_budget_alerts_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_budget_alerts
    ADD CONSTRAINT control_plane_budget_alerts_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.control_plane_agents(id) ON DELETE CASCADE;


--
-- Name: control_plane_budget_alerts control_plane_budget_alerts_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_budget_alerts
    ADD CONSTRAINT control_plane_budget_alerts_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.control_plane_teams(id) ON DELETE CASCADE;


--
-- Name: control_plane_budget_alerts control_plane_budget_alerts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_budget_alerts
    ADD CONSTRAINT control_plane_budget_alerts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: control_plane_executions control_plane_executions_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_executions
    ADD CONSTRAINT control_plane_executions_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.control_plane_agents(id) ON DELETE CASCADE;


--
-- Name: control_plane_executions control_plane_executions_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_executions
    ADD CONSTRAINT control_plane_executions_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.control_plane_teams(id) ON DELETE CASCADE;


--
-- Name: control_plane_executions control_plane_executions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_executions
    ADD CONSTRAINT control_plane_executions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: control_plane_heartbeats control_plane_heartbeats_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_heartbeats
    ADD CONSTRAINT control_plane_heartbeats_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.control_plane_agents(id) ON DELETE CASCADE;


--
-- Name: control_plane_heartbeats control_plane_heartbeats_execution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_heartbeats
    ADD CONSTRAINT control_plane_heartbeats_execution_id_fkey FOREIGN KEY (execution_id) REFERENCES public.control_plane_executions(id) ON DELETE SET NULL;


--
-- Name: control_plane_heartbeats control_plane_heartbeats_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_heartbeats
    ADD CONSTRAINT control_plane_heartbeats_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.control_plane_teams(id) ON DELETE CASCADE;


--
-- Name: control_plane_heartbeats control_plane_heartbeats_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_heartbeats
    ADD CONSTRAINT control_plane_heartbeats_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: control_plane_secret_audit control_plane_secret_audit_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_secret_audit
    ADD CONSTRAINT control_plane_secret_audit_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.provisioned_companies(id) ON DELETE CASCADE;


--
-- Name: control_plane_secret_audit control_plane_secret_audit_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_secret_audit
    ADD CONSTRAINT control_plane_secret_audit_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: control_plane_spend_entries control_plane_spend_entries_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_spend_entries
    ADD CONSTRAINT control_plane_spend_entries_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.control_plane_agents(id) ON DELETE CASCADE;


--
-- Name: control_plane_spend_entries control_plane_spend_entries_execution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_spend_entries
    ADD CONSTRAINT control_plane_spend_entries_execution_id_fkey FOREIGN KEY (execution_id) REFERENCES public.control_plane_executions(id) ON DELETE SET NULL;


--
-- Name: control_plane_spend_entries control_plane_spend_entries_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_spend_entries
    ADD CONSTRAINT control_plane_spend_entries_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.control_plane_teams(id) ON DELETE CASCADE;


--
-- Name: control_plane_spend_entries control_plane_spend_entries_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_spend_entries
    ADD CONSTRAINT control_plane_spend_entries_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: control_plane_tasks control_plane_tasks_assigned_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_tasks
    ADD CONSTRAINT control_plane_tasks_assigned_agent_id_fkey FOREIGN KEY (assigned_agent_id) REFERENCES public.control_plane_agents(id) ON DELETE SET NULL;


--
-- Name: control_plane_tasks control_plane_tasks_execution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_tasks
    ADD CONSTRAINT control_plane_tasks_execution_id_fkey FOREIGN KEY (execution_id) REFERENCES public.control_plane_executions(id) ON DELETE SET NULL;


--
-- Name: control_plane_tasks control_plane_tasks_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_tasks
    ADD CONSTRAINT control_plane_tasks_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.control_plane_teams(id) ON DELETE CASCADE;


--
-- Name: control_plane_tasks control_plane_tasks_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_tasks
    ADD CONSTRAINT control_plane_tasks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: control_plane_teams control_plane_teams_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_teams
    ADD CONSTRAINT control_plane_teams_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.provisioned_companies(id) ON DELETE CASCADE;


--
-- Name: control_plane_teams control_plane_teams_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.control_plane_teams
    ADD CONSTRAINT control_plane_teams_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: email_sends email_sends_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.email_sends
    ADD CONSTRAINT email_sends_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: email_sends email_sends_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.email_sends
    ADD CONSTRAINT email_sends_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: email_sends email_sends_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.email_sends
    ADD CONSTRAINT email_sends_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: icp_profiles icp_profiles_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.icp_profiles
    ADD CONSTRAINT icp_profiles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: leads leads_icp_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_icp_profile_id_fkey FOREIGN KEY (icp_profile_id) REFERENCES public.icp_profiles(id) ON DELETE SET NULL;


--
-- Name: leads leads_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: notification_channel_configs notification_channel_configs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.notification_channel_configs
    ADD CONSTRAINT notification_channel_configs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: notification_deliveries notification_deliveries_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.notification_events(id) ON DELETE CASCADE;


--
-- Name: notification_deliveries notification_deliveries_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: notification_events notification_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.notification_events
    ADD CONSTRAINT notification_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: notification_preferences notification_preferences_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: provisioned_companies provisioned_companies_team_fk; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.provisioned_companies
    ADD CONSTRAINT provisioned_companies_team_fk FOREIGN KEY (team_id) REFERENCES public.control_plane_teams(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: provisioned_companies provisioned_companies_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.provisioned_companies
    ADD CONSTRAINT provisioned_companies_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: provisioned_company_secrets provisioned_company_secrets_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.provisioned_company_secrets
    ADD CONSTRAINT provisioned_company_secrets_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.provisioned_companies(id) ON DELETE CASCADE;


--
-- Name: provisioned_company_secrets provisioned_company_secrets_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.provisioned_company_secrets
    ADD CONSTRAINT provisioned_company_secrets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: ticket_assignments ticket_assignments_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.ticket_assignments
    ADD CONSTRAINT ticket_assignments_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;


--
-- Name: ticket_notifications ticket_notifications_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.ticket_notifications
    ADD CONSTRAINT ticket_notifications_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;


--
-- Name: ticket_sla_policies ticket_sla_policies_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.ticket_sla_policies
    ADD CONSTRAINT ticket_sla_policies_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: ticket_sla_snapshots ticket_sla_snapshots_policy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.ticket_sla_snapshots
    ADD CONSTRAINT ticket_sla_snapshots_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES public.ticket_sla_policies(id) ON DELETE CASCADE;


--
-- Name: ticket_sla_snapshots ticket_sla_snapshots_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.ticket_sla_snapshots
    ADD CONSTRAINT ticket_sla_snapshots_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;


--
-- Name: ticket_sla_snapshots ticket_sla_snapshots_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.ticket_sla_snapshots
    ADD CONSTRAINT ticket_sla_snapshots_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: ticket_updates ticket_updates_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.ticket_updates
    ADD CONSTRAINT ticket_updates_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;


--
-- Name: tickets tickets_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.tickets(id) ON DELETE SET NULL;


--
-- Name: tickets tickets_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workflow_queue_jobs workflow_queue_jobs_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.workflow_queue_jobs
    ADD CONSTRAINT workflow_queue_jobs_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.workflow_runs(id) ON DELETE CASCADE;


--
-- Name: workflow_step_results workflow_step_results_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.workflow_step_results
    ADD CONSTRAINT workflow_step_results_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.workflow_runs(id) ON DELETE CASCADE;


--
-- Name: workspace_members workspace_members_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: paperclip
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: campaigns; Type: ROW SECURITY; Schema: public; Owner: paperclip
--

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: campaigns campaigns_tenant_isolation; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY campaigns_tenant_isolation ON public.campaigns USING (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id()))) WITH CHECK (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id())));


--
-- Name: control_plane_agents; Type: ROW SECURITY; Schema: public; Owner: paperclip
--

ALTER TABLE public.control_plane_agents ENABLE ROW LEVEL SECURITY;

--
-- Name: control_plane_agents control_plane_agents_tenant_isolation; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY control_plane_agents_tenant_isolation ON public.control_plane_agents USING (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id()))) WITH CHECK (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id())));


--
-- Name: control_plane_audit_log; Type: ROW SECURITY; Schema: public; Owner: paperclip
--

ALTER TABLE public.control_plane_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: control_plane_audit_log control_plane_audit_log_no_delete; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY control_plane_audit_log_no_delete ON public.control_plane_audit_log AS RESTRICTIVE FOR DELETE USING (false);


--
-- Name: control_plane_audit_log control_plane_audit_log_no_update; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY control_plane_audit_log_no_update ON public.control_plane_audit_log AS RESTRICTIVE FOR UPDATE USING (false) WITH CHECK (false);


--
-- Name: control_plane_audit_log control_plane_audit_log_tenant_isolation; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY control_plane_audit_log_tenant_isolation ON public.control_plane_audit_log USING (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id()))) WITH CHECK (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id())));


--
-- Name: control_plane_budget_alerts; Type: ROW SECURITY; Schema: public; Owner: paperclip
--

ALTER TABLE public.control_plane_budget_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: control_plane_budget_alerts control_plane_budget_alerts_tenant_isolation; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY control_plane_budget_alerts_tenant_isolation ON public.control_plane_budget_alerts USING (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id()))) WITH CHECK (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id())));


--
-- Name: control_plane_executions; Type: ROW SECURITY; Schema: public; Owner: paperclip
--

ALTER TABLE public.control_plane_executions ENABLE ROW LEVEL SECURITY;

--
-- Name: control_plane_executions control_plane_executions_tenant_isolation; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY control_plane_executions_tenant_isolation ON public.control_plane_executions USING (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id()))) WITH CHECK (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id())));


--
-- Name: control_plane_heartbeats; Type: ROW SECURITY; Schema: public; Owner: paperclip
--

ALTER TABLE public.control_plane_heartbeats ENABLE ROW LEVEL SECURITY;

--
-- Name: control_plane_heartbeats control_plane_heartbeats_tenant_isolation; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY control_plane_heartbeats_tenant_isolation ON public.control_plane_heartbeats USING (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id()))) WITH CHECK (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id())));


--
-- Name: control_plane_secret_audit; Type: ROW SECURITY; Schema: public; Owner: paperclip
--

ALTER TABLE public.control_plane_secret_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: control_plane_secret_audit control_plane_secret_audit_no_delete; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY control_plane_secret_audit_no_delete ON public.control_plane_secret_audit AS RESTRICTIVE FOR DELETE USING (false);


--
-- Name: control_plane_secret_audit control_plane_secret_audit_no_update; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY control_plane_secret_audit_no_update ON public.control_plane_secret_audit AS RESTRICTIVE FOR UPDATE USING (false) WITH CHECK (false);


--
-- Name: control_plane_secret_audit control_plane_secret_audit_tenant_isolation; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY control_plane_secret_audit_tenant_isolation ON public.control_plane_secret_audit USING (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id()))) WITH CHECK (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id())));


--
-- Name: control_plane_spend_entries; Type: ROW SECURITY; Schema: public; Owner: paperclip
--

ALTER TABLE public.control_plane_spend_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: control_plane_spend_entries control_plane_spend_entries_tenant_isolation; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY control_plane_spend_entries_tenant_isolation ON public.control_plane_spend_entries USING (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id()))) WITH CHECK (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id())));


--
-- Name: control_plane_tasks; Type: ROW SECURITY; Schema: public; Owner: paperclip
--

ALTER TABLE public.control_plane_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: control_plane_tasks control_plane_tasks_tenant_isolation; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY control_plane_tasks_tenant_isolation ON public.control_plane_tasks USING (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id()))) WITH CHECK (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id())));


--
-- Name: control_plane_teams; Type: ROW SECURITY; Schema: public; Owner: paperclip
--

ALTER TABLE public.control_plane_teams ENABLE ROW LEVEL SECURITY;

--
-- Name: control_plane_teams control_plane_teams_tenant_isolation; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY control_plane_teams_tenant_isolation ON public.control_plane_teams USING (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id()))) WITH CHECK (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id())));


--
-- Name: email_sends; Type: ROW SECURITY; Schema: public; Owner: paperclip
--

ALTER TABLE public.email_sends ENABLE ROW LEVEL SECURITY;

--
-- Name: email_sends email_sends_tenant_isolation; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY email_sends_tenant_isolation ON public.email_sends USING (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id()))) WITH CHECK (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id())));


--
-- Name: icp_profiles; Type: ROW SECURITY; Schema: public; Owner: paperclip
--

ALTER TABLE public.icp_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: icp_profiles icp_profiles_tenant_isolation; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY icp_profiles_tenant_isolation ON public.icp_profiles USING (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id()))) WITH CHECK (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id())));


--
-- Name: leads; Type: ROW SECURITY; Schema: public; Owner: paperclip
--

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

--
-- Name: leads leads_tenant_isolation; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY leads_tenant_isolation ON public.leads USING (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id()))) WITH CHECK (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id())));


--
-- Name: provisioned_companies; Type: ROW SECURITY; Schema: public; Owner: paperclip
--

ALTER TABLE public.provisioned_companies ENABLE ROW LEVEL SECURITY;

--
-- Name: provisioned_companies provisioned_companies_tenant_isolation; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY provisioned_companies_tenant_isolation ON public.provisioned_companies USING (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id()))) WITH CHECK (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id())));


--
-- Name: provisioned_company_secrets; Type: ROW SECURITY; Schema: public; Owner: paperclip
--

ALTER TABLE public.provisioned_company_secrets ENABLE ROW LEVEL SECURITY;

--
-- Name: provisioned_company_secrets provisioned_company_secrets_tenant_isolation; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY provisioned_company_secrets_tenant_isolation ON public.provisioned_company_secrets USING (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id()))) WITH CHECK (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id())));


--
-- Name: ticket_sla_policies; Type: ROW SECURITY; Schema: public; Owner: paperclip
--

ALTER TABLE public.ticket_sla_policies ENABLE ROW LEVEL SECURITY;

--
-- Name: ticket_sla_policies ticket_sla_policies_tenant_isolation; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY ticket_sla_policies_tenant_isolation ON public.ticket_sla_policies USING (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id()))) WITH CHECK (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id())));


--
-- Name: ticket_sla_snapshots; Type: ROW SECURITY; Schema: public; Owner: paperclip
--

ALTER TABLE public.ticket_sla_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: ticket_sla_snapshots ticket_sla_snapshots_tenant_isolation; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY ticket_sla_snapshots_tenant_isolation ON public.ticket_sla_snapshots USING (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id()))) WITH CHECK (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id())));


--
-- Name: tickets; Type: ROW SECURITY; Schema: public; Owner: paperclip
--

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

--
-- Name: tickets tickets_tenant_isolation; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY tickets_tenant_isolation ON public.tickets USING (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id()))) WITH CHECK (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id())));


--
-- Name: workspace_members; Type: ROW SECURITY; Schema: public; Owner: paperclip
--

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_members workspace_members_tenant_isolation; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY workspace_members_tenant_isolation ON public.workspace_members USING (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id()))) WITH CHECK (((public.app_current_workspace_id() IS NOT NULL) AND (workspace_id = public.app_current_workspace_id())));


--
-- Name: workspaces; Type: ROW SECURITY; Schema: public; Owner: paperclip
--

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

--
-- Name: workspaces workspaces_tenant_isolation; Type: POLICY; Schema: public; Owner: paperclip
--

CREATE POLICY workspaces_tenant_isolation ON public.workspaces USING (((public.app_current_workspace_id() IS NOT NULL) AND (id = public.app_current_workspace_id()) AND ((owner_user_id = public.app_current_user_id()) OR (EXISTS ( SELECT 1
   FROM public.workspace_members wm
  WHERE ((wm.workspace_id = workspaces.id) AND (wm.user_id = public.app_current_user_id()))))))) WITH CHECK (((public.app_current_workspace_id() IS NOT NULL) AND (id = public.app_current_workspace_id())));


--
-- PostgreSQL database dump complete
--

\unrestrict N89ikM41IW4kkK9CYCd8bPa0YMtCkgSp7PToBFnRx6dXRsjY1tGa3h5eosuergY

