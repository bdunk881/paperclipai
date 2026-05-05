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
        -H "X-User-Id: $USER_ID" \
        --data @"$payload_file" \
        "${BASE_URL}${path}"
    )
  else
    status=$(
      curl -sS -o "$body_file" -w "%{http_code}" \
        -X "$method" \
        -H "X-User-Id: $USER_ID" \
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
jq -e '.document.status == "ready" and .total >= 1' "$OUT_DIR/ingest-document.json" >/dev/null

cat > "$tmp_dir/search.json" <<JSON
{
  "query": "Fly staging smoke",
  "knowledgeBaseIds": ["${BASE_ID}"]
}
JSON
search_status=$(request "search" "POST" "/api/knowledge/search" "$OUT_DIR/search.json" "$tmp_dir/search.json")
require_status "$search_status" "200" "search"
jq -e --arg base_id "$BASE_ID" '.total >= 1 and (.results[0].knowledgeBase.id == $base_id)' "$OUT_DIR/search.json" >/dev/null

{
  echo "# FastAPI Fly.io Staging Smoke Evidence"
  echo
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "- Base URL: $BASE_URL"
  echo "- Smoke user id: $USER_ID"
  echo "- Knowledge base id: $BASE_ID"
  echo
  echo "## Requests"
  echo
  echo '```tsv'
  cat "$REQUEST_LOG"
  echo '```'
} > "$SUMMARY"
