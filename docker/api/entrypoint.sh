#!/usr/bin/env sh
#
# AutoFlow TS Express entrypoint wrapper.
#
# Mirrors docker/backend/entrypoint.sh so Fly machines pull dev/staging/prod
# secrets through Infisical the same way regardless of runtime.
#
# Behaviour:
#   - On Fly (FLY_APP_NAME or FLY_MACHINE_ID set): INFISICAL_TOKEN is required.
#   - Outside Fly without an INFISICAL_TOKEN: skip Infisical, run the command
#     directly. Useful for local docker runs that get env vars some other way.
#   - With INFISICAL_TOKEN set: `infisical run` injects secrets into the
#     child process environment, then exec the CMD.

set -eu

is_fly_runtime() {
  [ -n "${FLY_APP_NAME:-}" ] || [ -n "${FLY_MACHINE_ID:-}" ]
}

if [ -z "${INFISICAL_TOKEN:-}" ]; then
  if is_fly_runtime; then
    echo "INFISICAL_TOKEN is required to start the AutoFlow API on Fly." >&2
    exit 1
  fi

  echo "INFISICAL_TOKEN is not set; starting the API without Infisical." >&2
  exec "$@"
fi

if [ -z "${INFISICAL_PROJECT_ID:-}" ]; then
  echo "INFISICAL_PROJECT_ID is required when INFISICAL_TOKEN is set." >&2
  exit 1
fi

INFISICAL_ENV="${INFISICAL_ENV:-prod}"

exec infisical run --projectId "$INFISICAL_PROJECT_ID" --env "$INFISICAL_ENV" -- "$@"
