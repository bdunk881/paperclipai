#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="artifacts/qa-integration"
mkdir -p "$OUT_DIR"
SUMMARY="$OUT_DIR/summary.md"
PROBE_LOG="$OUT_DIR/probes.tsv"

if [[ -z "${QA_API_BASE_URL:-}" ]]; then
  echo "QA_API_BASE_URL is required" | tee "$OUT_DIR/error.txt"
  exit 1
fi

BASE_URL="${QA_API_BASE_URL%/}"
API_PREFIX="/api"
if [[ "$BASE_URL" == */api ]]; then
  API_PREFIX=""
fi
AUTH_HEADER=()
if [[ -n "${QA_E2E_BEARER_TOKEN:-}" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${QA_E2E_BEARER_TOKEN}")
fi
USER_HEADER=()
if [[ -n "${QA_E2E_USER_ID:-}" ]]; then
  USER_HEADER=(-H "X-User-Id: ${QA_E2E_USER_ID}")
fi
CONNECTOR_HEALTH_SLUGS=(${QA_CONNECTOR_HEALTH_SLUGS:-slack hubspot stripe gmail sentry linear teams})
CATALOG_CONNECTOR_SLUGS=(${QA_CATALOG_CONNECTOR_SLUGS:-slack hubspot stripe gmail sentry linear jira microsoft-teams})

printf "endpoint\tstatus\n" > "$PROBE_LOG"

probe() {
  local path="$1"
  local name="$2"
  local body="$OUT_DIR/${name}.body.txt"
  local status

  status=$(curl -sS -o "$body" -w "%{http_code}" "${AUTH_HEADER[@]}" "${USER_HEADER[@]}" "${BASE_URL}${path}" || true)
  printf "%s\t%s\n" "${BASE_URL}${path}" "$status" >> "$PROBE_LOG"
}

probe "/" "root"
probe "/health" "health"
probe "${API_PREFIX}/health" "api_health"
probe "${API_PREFIX}/status" "api_status"
probe "${API_PREFIX}/stripe/webhook" "stripe_webhook"

for slug in "${CONNECTOR_HEALTH_SLUGS[@]}"; do
  probe "${API_PREFIX}/integrations/${slug}/health" "connector_${slug}_health"
done

for slug in "${CATALOG_CONNECTOR_SLUGS[@]}"; do
  probe "${API_PREFIX}/integrations/catalog/${slug}" "catalog_${slug}"
done

reachable_count=$(awk 'NR>1 && $2 != "000" {count++} END {print count+0}' "$PROBE_LOG")
connector_route_failures=$(
  awk '
    NR > 1 && $1 ~ /\/api\/integrations\/[^/]+\/health$/ && ($2 == "000" || $2 == "404") {
      count++
    }
    NR > 1 && $1 ~ /\/api\/integrations\/catalog\/[^/]+$/ && ($2 == "000" || $2 == "404") {
      count++
    }
    END { print count + 0 }
  ' "$PROBE_LOG"
)

{
  echo "# QA Integration Evidence"
  echo
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "- QA_API_BASE_URL: ${BASE_URL}"
  echo "- QA_E2E_BEARER_TOKEN provided: $( [[ -n "${QA_E2E_BEARER_TOKEN:-}" ]] && echo yes || echo no )"
  echo "- QA_E2E_USER_ID provided: $( [[ -n "${QA_E2E_USER_ID:-}" ]] && echo yes || echo no )"
  echo "- STRIPE_WEBHOOK_SECRET provided: $( [[ -n "${STRIPE_WEBHOOK_SECRET:-}" ]] && echo yes || echo no )"
  echo "- VITE_USE_MOCK: ${VITE_USE_MOCK:-unset}"
  echo "- Connector health sweep slugs: ${CONNECTOR_HEALTH_SLUGS[*]}"
  echo "- Connector catalog sweep slugs: ${CATALOG_CONNECTOR_SLUGS[*]}"
  echo
  echo "## Probe Results"
  echo
  echo '```tsv'
  cat "$PROBE_LOG"
  echo '```'
  echo
  echo "Connector health endpoint expectations:"
  echo "- \`200\` = configured and healthy"
  echo "- \`206\` = configured but degraded"
  echo "- \`503\` = route is mounted but connector is down or not configured for this user"
  echo "- \`401/403\` = auth is required or the QA token is missing scopes"
  echo "- \`404/000\` = regression; route is missing or unreachable"
  echo
  echo "Connector catalog endpoint expectations:"
  echo "- \`200\` = manifest is published and deployable in this build"
  echo "- \`404/000\` = regression; connector manifest is missing or the API is unreachable"
} > "$SUMMARY"

if [[ "$reachable_count" -eq 0 ]]; then
  echo "No reachable QA endpoints detected from runner." | tee -a "$SUMMARY"
  exit 1
fi

if [[ "$connector_route_failures" -gt 0 ]]; then
  echo "One or more connector health endpoints returned 404/000." | tee -a "$SUMMARY"
  exit 1
fi
