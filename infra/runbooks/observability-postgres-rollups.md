# Runbook: Observability Postgres Partitioning and Rollups

## Purpose

This runbook defines the Sprint 1 storage and operations baseline for the
real-time observability dashboard in [ALT-1903](/ALT/issues/ALT-1903).
It standardizes:

- raw event storage in PostgreSQL only
- automated daily partition management for high-write event ingest
- 15-minute and daily rollup maintenance
- retention windows for each data tier
- the infrastructure constraints for server-sent events (SSE)

The design intentionally avoids introducing a second analytics system for v1.

## Source of Truth

- Migration: `migrations/013_observability_events.sql`
- Maintenance script: `infra/scripts/run_observability_rollups.sh`
- Scheduled workflow: `.github/workflows/observability-rollups.yml`

## Selected PostgreSQL Layout

Use a dedicated `observability` schema with three storage tiers:

1. `observability.events`
   Raw append-only event table partitioned by `occurred_at` in daily ranges.
2. `observability.rollups_15m`
   Mutable aggregate table refreshed from recent raw events every 15 minutes.
3. `observability.rollups_daily`
   Mutable aggregate table refreshed from recent raw events for long-range charts.

This keeps write amplification acceptable while letting backend query either raw
recent events or pre-aggregated time buckets from the same database.

## Why Daily Partitions

Daily partitions are the simplest fit for the required raw-event retention
window. They allow precise partition pruning and partition dropping without
carrying extra weeks of expired data that monthly partitions would retain.

The migration provisions partitions from yesterday through the next 14 days.
The scheduled maintenance job extends that window every run.

## Rollup Cadence

The selected v1 cadence is:

- raw events: ingested continuously
- partition maintenance: every 15 minutes
- 15-minute rollups: refreshed every 15 minutes with a 48-hour lookback
- daily rollups: refreshed by the same maintenance run with a 48-hour lookback

The 48-hour lookback is deliberate. It absorbs late-arriving events and makes
reruns idempotent without requiring full-table rescans.

## Retention Policy

The explicit retention contract for v1 is:

- raw events: `30` days
- 15-minute rollups: `180` days
- daily rollups: `730` days

Those defaults are encoded in `infra/scripts/run_observability_rollups.sh` and
can be overridden through GitHub Actions variables if requirements change.

## Scheduler Choice

The v1 scheduler is GitHub Actions, not app-local cron and not a second data
platform. This choice matches existing repo operations patterns and keeps the
maintenance path fully IaC-managed inside the repository.

Workflow:

- `.github/workflows/observability-rollups.yml`
- trigger: every 15 minutes plus manual dispatch
- credential: `OBSERVABILITY_DATABASE_URL`

If dashboard freshness later requires sub-15-minute buckets or private network
execution, move the same script into an Azure Functions timer or Container Apps
job. The SQL contract does not need to change for that migration.

## Required GitHub Configuration

Add these GitHub Actions settings before enabling the schedule:

### Secret

- `OBSERVABILITY_DATABASE_URL`
  PostgreSQL connection string for the environment that owns observability data.

### Optional repository or environment variables

- `OBS_FUTURE_PARTITION_DAYS` default `14`
- `OBS_ROLLUP_LOOKBACK_HOURS` default `48`
- `OBS_RAW_RETENTION_DAYS` default `30`
- `OBS_15M_RETENTION_DAYS` default `180`
- `OBS_DAILY_RETENTION_DAYS` default `730`

## Deployment Sequence

1. Apply the migration set including `migrations/013_observability_events.sql`.
2. Verify the `observability` schema and initial daily partitions exist.
3. Add `OBSERVABILITY_DATABASE_URL` in GitHub Actions.
4. Manually run `Observability Rollups` once with `workflow_dispatch`.
5. Confirm the artifact log contains:
   - `Applying observability maintenance`
   - `Observability maintenance completed successfully.`
6. Leave the 15-minute schedule enabled.

## Validation Queries

```sql
SELECT schemaname, tablename
FROM pg_tables
WHERE schemaname = 'observability'
ORDER BY tablename;

SELECT inhrelid::regclass::text AS partition_name
FROM pg_inherits
WHERE inhparent = 'observability.events'::regclass
ORDER BY partition_name;

SELECT bucket_start, event_count, error_count
FROM observability.rollups_15m
ORDER BY bucket_start DESC
LIMIT 10;

SELECT bucket_date, event_count, error_count
FROM observability.rollups_daily
ORDER BY bucket_date DESC
LIMIT 10;
```

## SSE Runtime Requirements

SSE stays on the primary backend. Do not add a separate stream broker for v1.

### Production on AKS

The ingress/controller path must preserve long-lived streaming responses:

- disable proxy buffering on the SSE route
- allow at least 1 hour for `proxy-read-timeout` and `proxy-send-timeout`
- preserve `Content-Type: text/event-stream`
- preserve `Cache-Control: no-cache, no-transform`

If the production ingress is `ingress-nginx`, add route-level annotations such as:

```yaml
nginx.ingress.kubernetes.io/proxy-buffering: "off"
nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
```

### Staging on Azure Container Apps

SSE is compatible with Container Apps HTTP ingress, but staging should keep:

- `minReplicas >= 1` to reduce cold-start disconnects
- no response buffering in any proxy layer in front of the app
- application heartbeats every 15-30 seconds to keep idle connections active

### Application Contract

Backend implementation must:

- flush an initial event quickly after connection establishment
- send heartbeat comments or events on a fixed interval
- handle reconnects with `Last-Event-ID` once frontend adds replay support

## Known Risks

- GitHub Actions cron is reliable enough for 15-minute aggregates, but it is not
  a hard real-time scheduler.
- Daily partitions assume event timestamps arrive close to real time. If backfill
  jobs start loading historical data, create partitions for those dates first.
- SSE concurrency will depend on backend worker sizing; the hosting layer alone
  does not guarantee adequate fan-out capacity.
