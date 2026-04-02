#!/usr/bin/env bash
# ==============================================================================
# db-backup.sh — PostgreSQL backup script for AutoFlow (helloautoflow.com)
#
# Dumps the database with pg_dump, compresses with gzip, uploads to S3,
# and enforces a rolling retention window by pruning old dumps.
#
# Required environment variables:
#   DATABASE_URL              — PostgreSQL DSN (postgres://user:pass@host:port/db)
#   S3_BACKUP_BUCKET          — S3 bucket name (e.g. autoflow-db-backups)
#   AWS_ACCESS_KEY_ID         — AWS access key
#   AWS_SECRET_ACCESS_KEY     — AWS secret key
#
# Optional environment variables:
#   AWS_DEFAULT_REGION        — AWS region (default: us-east-1)
#   BACKUP_RETENTION_DAYS     — Days of backups to keep (default: 7)
#   BACKUP_ALERT_URL          — Webhook URL for success/failure notifications
#
# Exit codes:
#   0 — Success
#   1 — Failure
# ==============================================================================

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
BACKUP_S3_PREFIX="postgres"

# ── Logging ───────────────────────────────────────────────────────────────────
log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"
}

log_error() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR: $*" >&2
}

# ── Notification ──────────────────────────────────────────────────────────────
send_alert() {
  local status="$1"
  local message="$2"

  if [[ -n "${BACKUP_ALERT_URL:-}" ]]; then
    local payload
    payload=$(printf '{"status":"%s","message":"%s"}' "$status" "$message")
    curl \
      --silent \
      --fail \
      --max-time 10 \
      --retry 2 \
      --retry-delay 3 \
      -H "Content-Type: application/json" \
      -X POST \
      -d "$payload" \
      "$BACKUP_ALERT_URL" \
      || log_error "Failed to send alert notification to BACKUP_ALERT_URL"
  fi
}

# ── Cleanup on exit ───────────────────────────────────────────────────────────
TMPDIR_BACKUP=""

cleanup() {
  local exit_code=$?

  if [[ -n "$TMPDIR_BACKUP" && -d "$TMPDIR_BACKUP" ]]; then
    rm -rf "$TMPDIR_BACKUP"
    log "Cleaned up temporary directory."
  fi

  if [[ $exit_code -ne 0 ]]; then
    log_error "Backup script exited with code $exit_code."
    send_alert "failure" "AutoFlow DB backup failed at $(date -u '+%Y-%m-%dT%H:%M:%SZ'). Exit code: $exit_code"
  fi
}

trap cleanup EXIT

# ── Validate required env vars ────────────────────────────────────────────────
for var in DATABASE_URL S3_BACKUP_BUCKET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
  if [[ -z "${!var:-}" ]]; then
    log_error "Required environment variable '$var' is not set."
    exit 1
  fi
done

# ── Parse DATABASE_URL ────────────────────────────────────────────────────────
# Expected format: postgres://user:password@host:port/dbname
#                  postgresql://user:password@host:port/dbname
parse_database_url() {
  local url="${DATABASE_URL}"

  # Strip scheme
  url="${url#postgres://}"
  url="${url#postgresql://}"

  # Extract user:password
  local userinfo="${url%%@*}"
  local rest="${url#*@}"

  DB_USER="${userinfo%%:*}"
  DB_PASSWORD="${userinfo#*:}"

  # Extract host:port
  local hostinfo="${rest%%/*}"
  DB_HOST="${hostinfo%%:*}"
  DB_PORT="${hostinfo#*:}"
  # If no port separator found, default to 5432
  if [[ "$DB_PORT" == "$DB_HOST" ]]; then
    DB_PORT="5432"
  fi

  # Extract database name (strip query string if present)
  local dbpart="${rest#*/}"
  DB_NAME="${dbpart%%\?*}"

  if [[ -z "$DB_HOST" || -z "$DB_NAME" || -z "$DB_USER" ]]; then
    log_error "Could not parse DATABASE_URL. Expected: postgres://user:pass@host:port/dbname"
    exit 1
  fi
}

parse_database_url

log "Parsed connection: host=${DB_HOST} port=${DB_PORT} user=${DB_USER} db=${DB_NAME}"

# ── Prepare temporary directory ───────────────────────────────────────────────
TMPDIR_BACKUP=$(mktemp -d /tmp/db-backup.XXXXXX)
log "Using temporary directory: $TMPDIR_BACKUP"

# ── Generate filenames ────────────────────────────────────────────────────────
TIMESTAMP=$(date -u '+%Y%m%dT%H%M%SZ')
DUMP_FILENAME="${DB_NAME}_${TIMESTAMP}.dump.gz"
DUMP_LOCAL_PATH="${TMPDIR_BACKUP}/${DUMP_FILENAME}"
S3_KEY="${BACKUP_S3_PREFIX}/${DUMP_FILENAME}"
S3_URI="s3://${S3_BACKUP_BUCKET}/${S3_KEY}"

# ── Run pg_dump ───────────────────────────────────────────────────────────────
log "Starting pg_dump for database '${DB_NAME}' on ${DB_HOST}:${DB_PORT}..."

export PGPASSWORD="${DB_PASSWORD}"

if ! pg_dump \
  --host="${DB_HOST}" \
  --port="${DB_PORT}" \
  --username="${DB_USER}" \
  --dbname="${DB_NAME}" \
  --format=custom \
  --compress=0 \
  --no-password \
  | gzip --best > "${DUMP_LOCAL_PATH}"; then
  log_error "pg_dump failed."
  exit 1
fi

unset PGPASSWORD

DUMP_SIZE=$(du -sh "${DUMP_LOCAL_PATH}" | cut -f1)
log "pg_dump completed successfully. Compressed size: ${DUMP_SIZE}"

# ── Upload to S3 ──────────────────────────────────────────────────────────────
log "Uploading ${DUMP_FILENAME} to ${S3_URI}..."

export AWS_DEFAULT_REGION
export AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY

if ! aws s3 cp \
  "${DUMP_LOCAL_PATH}" \
  "${S3_URI}" \
  --storage-class STANDARD_IA \
  --no-progress; then
  log_error "S3 upload failed."
  exit 1
fi

log "Upload completed: ${S3_URI}"

# ── Enforce retention policy ───────────────────────────────────────────────────
log "Enforcing ${BACKUP_RETENTION_DAYS}-day retention policy on s3://${S3_BACKUP_BUCKET}/${BACKUP_S3_PREFIX}/..."

CUTOFF_EPOCH=$(date -u -d "${BACKUP_RETENTION_DAYS} days ago" '+%s' 2>/dev/null \
  || date -u -v "-${BACKUP_RETENTION_DAYS}d" '+%s' 2>/dev/null \
  || { log_error "Cannot determine cutoff date; skipping retention enforcement."; exit 0; })

DELETED_COUNT=0
RETENTION_ERRORS=0

while IFS= read -r line; do
  # aws s3 ls output: "2024-01-15 02:01:23  123456789 postgres/autoflow_....dump.gz"
  OBJECT_DATE=$(echo "$line" | awk '{print $1, $2}')
  OBJECT_KEY=$(echo "$line" | awk '{print $4}')

  if [[ -z "$OBJECT_KEY" ]]; then
    continue
  fi

  OBJECT_EPOCH=$(date -u -d "$OBJECT_DATE" '+%s' 2>/dev/null \
    || date -u -j -f "%Y-%m-%d %H:%M:%S" "$OBJECT_DATE" '+%s' 2>/dev/null \
    || echo "0")

  if [[ "$OBJECT_EPOCH" -lt "$CUTOFF_EPOCH" ]]; then
    log "Deleting expired backup: s3://${S3_BACKUP_BUCKET}/${OBJECT_KEY} (last modified: ${OBJECT_DATE})"
    if aws s3 rm "s3://${S3_BACKUP_BUCKET}/${OBJECT_KEY}" --quiet; then
      DELETED_COUNT=$((DELETED_COUNT + 1))
    else
      log_error "Failed to delete s3://${S3_BACKUP_BUCKET}/${OBJECT_KEY}"
      RETENTION_ERRORS=$((RETENTION_ERRORS + 1))
    fi
  fi
done < <(aws s3 ls "s3://${S3_BACKUP_BUCKET}/${BACKUP_S3_PREFIX}/" 2>/dev/null || true)

log "Retention enforcement complete. Deleted: ${DELETED_COUNT} object(s). Errors: ${RETENTION_ERRORS}."

if [[ $RETENTION_ERRORS -gt 0 ]]; then
  log_error "Some old backups could not be deleted. Review S3 permissions."
fi

# ── Success ───────────────────────────────────────────────────────────────────
log "Backup job completed successfully."
log "  Backup file : ${S3_URI}"
log "  Dump size   : ${DUMP_SIZE}"
log "  Timestamp   : ${TIMESTAMP}"

send_alert "success" "AutoFlow DB backup succeeded at $(date -u '+%Y-%m-%dT%H:%M:%SZ'). File: ${S3_URI} (${DUMP_SIZE})"

exit 0
