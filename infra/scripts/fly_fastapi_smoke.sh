#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${FASTAPI_SMOKE_BASE_URL:-}" ]]; then
  echo "FASTAPI_SMOKE_BASE_URL is required" >&2
  exit 1
fi

BASE_URL="${FASTAPI_SMOKE_BASE_URL%/}"
USER_ID="${FASTAPI_SMOKE_USER_ID:-qa-smoke-user}"
OUT_DIR="${FASTAPI_SMOKE_OUTPUT_DIR:-artifacts/fly-fastapi-smoke}"
SUMMARY="$OUT_DIR/summary.md"
REQUEST_LOG="$OUT_DIR/requests.tsv"
ORIGIN="${FASTAPI_SMOKE_ORIGIN:-https://app.helloautoflow.com}"
ENABLE_STATEFUL_KB_CHECKS="${FASTAPI_SMOKE_ENABLE_STATEFUL_KB_CHECKS:-true}"

mkdir -p "$OUT_DIR"
printf "step\tstatus\tpath\n" > "$REQUEST_LOG"

request() {
  local step="$1"
  local method="$2"
  local path="$3"
  local body_file="$4"
  local payload_file="${5:-}"
  local content_type="${6:-application/json}"
  local status

  if [[ -n "$payload_file" ]]; then
    status=$(
      curl -sS -o "$body_file" -w "%{http_code}" \
        -X "$method" \
        -H "Content-Type: $content_type" \
        -H "X-User-Id: $USER_ID" \
        -H "Origin: $ORIGIN" \
        --data @"$payload_file" \
        "${BASE_URL}${path}"
    )
  else
    status=$(
      curl -sS -o "$body_file" -w "%{http_code}" \
        -X "$method" \
        -H "X-User-Id: $USER_ID" \
        -H "Origin: $ORIGIN" \
        "${BASE_URL}${path}"
    )
  fi

  printf "%s\t%s\t%s\n" "$step" "$status" "$path" >> "$REQUEST_LOG"
  echo "$status"
}

require_status() {
  local actual="$1"
  local expected="$2"
  local step="$3"

  if [[ "$actual" != "$expected" ]]; then
    echo "Smoke step '$step' failed: expected HTTP $expected, got $actual" >&2
    exit 1
  fi
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

require_json_detail_not_equal() {
  local body_file="$1"
  local forbidden_detail="$2"
  local step="$3"
  local actual_detail

  actual_detail="$(jq -r '.detail // empty' "$body_file" 2>/dev/null || true)"
  if [[ "$actual_detail" == "$forbidden_detail" ]]; then
    echo "Smoke step '$step' failed: relay response still reports '$forbidden_detail'" >&2
    exit 1
  fi
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cat > "$tmp_dir/create-base.json" <<'JSON'
{
  "name": "Fly Smoke KB",
  "description": "Smoke test knowledge base",
  "tags": ["smoke", "fly"],
  "chunkingConfig": {
    "maxCharacters": 120
  }
}
JSON

health_status=$(request "health" "GET" "/health" "$OUT_DIR/health.json")
require_status "$health_status" "200" "health"
jq -e '.status == "ok"' "$OUT_DIR/health.json" >/dev/null

create_status=$(request "create_base" "POST" "/api/knowledge/bases" "$OUT_DIR/create-base.json" "$tmp_dir/create-base.json")
require_status "$create_status" "201" "create_base"
BASE_ID="$(jq -r '.id' "$OUT_DIR/create-base.json")"
if [[ -z "$BASE_ID" || "$BASE_ID" == "null" ]]; then
  echo "Smoke step 'create_base' did not return a knowledge base id" >&2
  exit 1
fi

if [[ "$ENABLE_STATEFUL_KB_CHECKS" == "true" ]]; then
  list_status=$(request "list_bases" "GET" "/api/knowledge/bases" "$OUT_DIR/list-bases.json")
  require_status "$list_status" "200" "list_bases"
  jq -e --arg base_id "$BASE_ID" '.bases | any(.id == $base_id)' "$OUT_DIR/list-bases.json" >/dev/null

  cat > "$tmp_dir/update-base.json" <<'JSON'
{
  "description": "Updated during Fly smoke verification",
  "tags": ["smoke", "fly", "verified"]
}
JSON
  update_status=$(request "update_base" "PATCH" "/api/knowledge/bases/${BASE_ID}" "$OUT_DIR/update-base.json" "$tmp_dir/update-base.json")
  require_status "$update_status" "200" "update_base"
  jq -e '.description == "Updated during Fly smoke verification"' "$OUT_DIR/update-base.json" >/dev/null

  cat > "$tmp_dir/ingest-document.json" <<'JSON'
{
  "filename": "smoke.txt",
  "mimeType": "text/plain",
  "content": "Fly staging smoke tests verify health, CRUD, ingest, and search for the FastAPI knowledge service."
}
JSON
  ingest_status=$(request "ingest_document" "POST" "/api/knowledge/bases/${BASE_ID}/documents" "$OUT_DIR/ingest-document.json" "$tmp_dir/ingest-document.json")
  require_status "$ingest_status" "201" "ingest_document"
  jq -e '.document.status == "ready" and ((.chunks | length) >= 1 or (.document.chunkCount // 0) >= 1 or (.total // 0) >= 1)' "$OUT_DIR/ingest-document.json" >/dev/null

  cat > "$tmp_dir/search.json" <<JSON
{
  "query": "Fly staging smoke",
  "knowledgeBaseIds": ["${BASE_ID}"]
}
JSON
  search_status=$(request "search" "POST" "/api/knowledge/search" "$OUT_DIR/search.json" "$tmp_dir/search.json")
  require_status "$search_status" "200" "search"
  jq -e --arg base_id "$BASE_ID" '.total >= 1 and (.results[0].knowledgeBase.id == $base_id)' "$OUT_DIR/search.json" >/dev/null
fi

cat > "$tmp_dir/auth-initiate.json" <<'JSON'
{
  "client_id": "smoke-client",
  "scope": "openid profile offline_access",
  "response_type": "code",
  "redirect_uri": "https://app.helloautoflow.com/auth/callback"
}
JSON
auth_status=$(request "native_auth_initiate" "POST" "/api/auth/native/oauth2/v2.0/initiate" "$OUT_DIR/native-auth-initiate.json" "$tmp_dir/auth-initiate.json")
require_status_in "$auth_status" "200,400" "native_auth_initiate"
require_json_detail_not_equal "$OUT_DIR/native-auth-initiate.json" "Origin is not allowed for native auth proxy requests." "native_auth_initiate"

callback_status=$(request "slack_oauth_callback_surface" "GET" "/api/integrations/slack/oauth/callback?error=access_denied&error_description=fly_cutover_probe" "$OUT_DIR/slack-oauth-callback.json")
require_status_in "$callback_status" "200,302,307,400,401" "slack_oauth_callback_surface"
require_json_detail_not_equal "$OUT_DIR/slack-oauth-callback.json" "Public edge relay is not configured." "slack_oauth_callback_surface"

cat > "$tmp_dir/stripe-webhook.json" <<'JSON'
{}
JSON
stripe_status=$(request "stripe_webhook_surface" "POST" "/api/webhooks/stripe" "$OUT_DIR/stripe-webhook.json" "$tmp_dir/stripe-webhook.json")
require_status_in "$stripe_status" "400,401,503" "stripe_webhook_surface"
require_json_detail_not_equal "$OUT_DIR/stripe-webhook.json" "Public edge relay is not configured." "stripe_webhook_surface"

{
  echo "# FastAPI Fly.io Staging Smoke Evidence"
  echo
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "- Base URL: $BASE_URL"
  echo "- Smoke user id: $USER_ID"
  echo "- Browser origin: $ORIGIN"
  echo "- Stateful knowledge follow-up checks: $ENABLE_STATEFUL_KB_CHECKS"
  echo "- Knowledge base id: $BASE_ID"
  echo
  echo "## Probe Matrix"
  echo
  echo "- \`GET /health\` => expect \`200\`"
  echo "- \`POST /api/auth/native/oauth2/v2.0/initiate\` => expect \`200\` or provider validation \`400\`"
  echo "- \`GET /api/integrations/slack/oauth/callback?error=...\` => expect callback relay response \`200\`, \`302\`, \`307\`, \`400\`, or \`401\`"
  echo "- \`POST /api/webhooks/stripe\` with unsigned payload => expect upstream response \`400\`, \`401\`, or a relayed legacy \`503\`"
  echo
  echo "## Requests"
  echo
  echo '```tsv'
  cat "$REQUEST_LOG"
  echo '```'
} > "$SUMMARY"
