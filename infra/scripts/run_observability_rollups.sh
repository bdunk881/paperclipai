#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required but was not found in PATH" >&2
  exit 1
fi

DATABASE_URL_VALUE="${OBSERVABILITY_DATABASE_URL:-${DATABASE_URL:-}}"
if [[ -z "$DATABASE_URL_VALUE" ]]; then
  echo "OBSERVABILITY_DATABASE_URL or DATABASE_URL is required" >&2
  exit 1
fi

OBS_PARTITION_START_DATE="${OBS_PARTITION_START_DATE:-$(date -u -v-1d +%F 2>/dev/null || date -u -d '1 day ago' +%F)}"
OBS_FUTURE_PARTITION_DAYS="${OBS_FUTURE_PARTITION_DAYS:-14}"
OBS_ROLLUP_LOOKBACK_HOURS="${OBS_ROLLUP_LOOKBACK_HOURS:-48}"
OBS_RAW_RETENTION_DAYS="${OBS_RAW_RETENTION_DAYS:-30}"
OBS_15M_RETENTION_DAYS="${OBS_15M_RETENTION_DAYS:-180}"
OBS_DAILY_RETENTION_DAYS="${OBS_DAILY_RETENTION_DAYS:-730}"

echo "Applying observability maintenance"
echo "partition_start_date=${OBS_PARTITION_START_DATE}"
echo "future_partition_days=${OBS_FUTURE_PARTITION_DAYS}"
echo "rollup_lookback_hours=${OBS_ROLLUP_LOOKBACK_HOURS}"
echo "raw_retention_days=${OBS_RAW_RETENTION_DAYS}"
echo "rollup_15m_retention_days=${OBS_15M_RETENTION_DAYS}"
echo "rollup_daily_retention_days=${OBS_DAILY_RETENTION_DAYS}"

psql "$DATABASE_URL_VALUE" \
  -v ON_ERROR_STOP=1 \
  -v obs_partition_start_date="$OBS_PARTITION_START_DATE" \
  -v obs_future_partition_days="$OBS_FUTURE_PARTITION_DAYS" \
  -v obs_rollup_lookback_hours="$OBS_ROLLUP_LOOKBACK_HOURS" \
  -v obs_raw_retention_days="$OBS_RAW_RETENTION_DAYS" \
  -v obs_15m_retention_days="$OBS_15M_RETENTION_DAYS" \
  -v obs_daily_retention_days="$OBS_DAILY_RETENTION_DAYS" <<'SQL'
SELECT observability.ensure_event_partitions(
  :'obs_partition_start_date'::date,
  :'obs_future_partition_days'::integer
);

SELECT observability.refresh_rollups(
  make_interval(hours => :'obs_rollup_lookback_hours'::integer)
);

SELECT observability.apply_retention(
  :'obs_raw_retention_days'::integer,
  :'obs_15m_retention_days'::integer,
  :'obs_daily_retention_days'::integer
);
SQL

echo "Observability maintenance completed successfully."
