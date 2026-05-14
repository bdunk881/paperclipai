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

# When INFISICAL_TOKEN + INFISICAL_PROJECT_ID are set, wrap the CMD in
# `infisical run` so secrets get injected at runtime. When they're absent,
# exec the CMD directly — the Fly machine's `flyctl secrets set` from the
# deploy workflow already pinned the runtime env vars (DATABASE_URL,
# SUPABASE_*, etc.) onto the machine, so process.env is populated either way.
#
# Either path produces a working server; the Infisical wrap just enables
# secret rotation without redeploying. v1 ships with direct env vars to
# avoid a runtime-Infisical bootstrap dependency; flip to the wrapped path
# once INFISICAL_PROJECT_ID + INFISICAL_TOKEN exist in Infisical's per-env
# secret set.

if [ -z "${INFISICAL_TOKEN:-}" ] || [ -z "${INFISICAL_PROJECT_ID:-}" ]; then
  echo "INFISICAL_TOKEN/INFISICAL_PROJECT_ID not set; starting API with direct env vars." >&2
  exec "$@"
fi

INFISICAL_ENV="${INFISICAL_ENV:-prod}"

exec infisical run --projectId "$INFISICAL_PROJECT_ID" --env "$INFISICAL_ENV" -- "$@"
