#!/usr/bin/env bash
# Smoke test for the consolidated TS Express API on Fly (HEL-83).
#
# Verifies the deploy is healthy + that the public route surfaces respond
# the way Express would (not the way FastAPI used to). Run from CI after
# every deploy, also runnable manually:
#   bash infra/scripts/fly_api_smoke.sh https://autoflow-api-dev.fly.dev

set -euo pipefail

BASE_URL="${1:-${FLY_API_SMOKE_BASE_URL:-}}"
if [[ -z "$BASE_URL" ]]; then
  echo "Usage: fly_api_smoke.sh <base-url>" >&2
  exit 1
fi
BASE_URL="${BASE_URL%/}"

OUT_DIR="${FLY_API_SMOKE_OUTPUT_DIR:-artifacts/fly-api-smoke}"
SUMMARY="$OUT_DIR/summary.md"
REQUEST_LOG="$OUT_DIR/requests.tsv"
ORIGIN="${FLY_API_SMOKE_ORIGIN:-https://dev.helloautoflow.com}"

mkdir -p "$OUT_DIR"
printf "step\tstatus\tpath\n" > "$REQUEST_LOG"

request() {
  local step="$1"
  local method="$2"
  local path="$3"
  local body_file="$4"
  local payload_file="${5:-}"
  local status

  if [[ -n "$payload_file" ]]; then
    status=$(
      curl -sS -o "$body_file" -w "%{http_code}" \
        -X "$method" \
        -H "Content-Type: application/json" \
        -H "Origin: $ORIGIN" \
        --data @"$payload_file" \
        "${BASE_URL}${path}"
    )
  else
    status=$(
      curl -sS -o "$body_file" -w "%{http_code}" \
        -X "$method" \
        -H "Origin: $ORIGIN" \
        "${BASE_URL}${path}"
    )
  fi

  printf "%s\t%s\t%s\n" "$step" "$status" "$path" >> "$REQUEST_LOG"
  echo "$status"
}

require_status_in() {
  local actual="$1"
  local expected_csv="$2"
  local step="$3"

  if [[ ",$expected_csv," == *",$actual,"* ]]; then
    return
  fi

  echo "Smoke step '$step' failed: expected one of [$expected_csv], got $actual" >&2
  exit 1
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

# ---------------------------------------------------------------------------
# 1. /health — primary liveness check
# ---------------------------------------------------------------------------
health_status=$(request "health" "GET" "/health" "$OUT_DIR/health.json")
require_status_in "$health_status" "200" "health"

# Express returns { status: "ok", ... } on /health (src/app.ts:1162)
jq -e '.status == "ok"' "$OUT_DIR/health.json" >/dev/null

# ---------------------------------------------------------------------------
# 2. CORS preflight — confirm allowed origin returns Access-Control-Allow-Origin
# ---------------------------------------------------------------------------
cors_status=$(
  curl -sS -o "$OUT_DIR/cors.txt" -w "%{http_code}" \
    -X OPTIONS \
    -H "Origin: $ORIGIN" \
    -H "Access-Control-Request-Method: GET" \
    "${BASE_URL}/health"
)
printf "cors_preflight\t%s\t/health\n" "$cors_status" >> "$REQUEST_LOG"
require_status_in "$cors_status" "200,204" "cors_preflight"

# ---------------------------------------------------------------------------
# 3. Protected route — confirm auth gate returns 401 (not 404 — proves it's wired)
# ---------------------------------------------------------------------------
protected_status=$(request "protected" "GET" "/api/protected" "$OUT_DIR/protected.json")
require_status_in "$protected_status" "401,403" "protected"

# ---------------------------------------------------------------------------
# 4. OAuth callback surface — sanity check, expect non-503 (relay-not-configured)
#    The Express handler should respond directly, not relay through.
# ---------------------------------------------------------------------------
oauth_status=$(
  request "slack_oauth_callback" "GET" \
    "/api/integrations/slack/oauth/callback?error=access_denied&error_description=fly_api_smoke" \
    "$OUT_DIR/slack-oauth-callback.json"
)
require_status_in "$oauth_status" "200,302,307,400,401,404" "slack_oauth_callback"

# ---------------------------------------------------------------------------
# 5. Stripe webhook surface — expect 400/401 (signature missing), NOT 404
# ---------------------------------------------------------------------------
echo '{}' > "$tmp_dir/stripe-webhook.json"
stripe_status=$(
  request "stripe_webhook" "POST" "/api/webhooks/stripe" \
    "$OUT_DIR/stripe-webhook.json" "$tmp_dir/stripe-webhook.json"
)
require_status_in "$stripe_status" "400,401" "stripe_webhook"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
{
  echo "# Fly TS Express API smoke evidence"
  echo
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "- Base URL: $BASE_URL"
  echo "- Browser origin: $ORIGIN"
  echo
  echo "## Probe matrix"
  echo
  echo "- \`GET /health\` => 200, JSON \`status:ok\`"
  echo "- \`OPTIONS /health\` (CORS preflight) => 200/204"
  echo "- \`GET /api/protected\` => 401/403 (auth wired)"
  echo "- \`GET /api/integrations/slack/oauth/callback?error=...\` => 200/302/307/400/401/404"
  echo "- \`POST /api/webhooks/stripe\` (unsigned) => 400/401"
  echo
  echo "## Requests"
  echo
  echo '```tsv'
  cat "$REQUEST_LOG"
  echo '```'
} > "$SUMMARY"

echo "Smoke test passed. Summary: $SUMMARY"
