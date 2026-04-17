#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="${ROOT_DIR}/migrations"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required but was not found in PATH" >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

shopt -s nullglob
migration_files=("${MIGRATIONS_DIR}"/*.sql)

if (( ${#migration_files[@]} == 0 )); then
  echo "No SQL migration files found in ${MIGRATIONS_DIR}" >&2
  exit 1
fi

for migration in "${migration_files[@]}"; do
  echo "Applying ${migration##*/}"
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${migration}"
done

echo "All migrations applied successfully."
