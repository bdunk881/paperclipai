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

printf "endpoint\tstatus\n" > "$PROBE_LOG"

probe() {
  local path="$1"
  local name="$2"
  local body="$OUT_DIR/${name}.body.txt"
  local status

  if [[ ${#AUTH_HEADER[@]} -gt 0 ]]; then
    status=$(curl -sS -o "$body" -w "%{http_code}" "${AUTH_HEADER[@]}" "${BASE_URL}${path}" || true)
  else
    status=$(curl -sS -o "$body" -w "%{http_code}" "${BASE_URL}${path}" || true)
  fi
  printf "%s\t%s\n" "${BASE_URL}${path}" "$status" >> "$PROBE_LOG"
}

probe "/" "root"
probe "/health" "health"
probe "${API_PREFIX}/health" "api_health"
probe "${API_PREFIX}/status" "api_status"
probe "${API_PREFIX}/stripe/webhook" "stripe_webhook"

reachable_count=$(awk 'NR>1 && $2 != "000" {count++} END {print count+0}' "$PROBE_LOG")

{
  echo "# QA Integration Evidence"
  echo
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "- QA_API_BASE_URL: ${BASE_URL}"
  echo "- QA_E2E_BEARER_TOKEN provided: $( [[ -n "${QA_E2E_BEARER_TOKEN:-}" ]] && echo yes || echo no )"
  echo "- STRIPE_WEBHOOK_SECRET provided: $( [[ -n "${STRIPE_WEBHOOK_SECRET:-}" ]] && echo yes || echo no )"
  echo "- VITE_USE_MOCK: ${VITE_USE_MOCK:-unset}"
  echo
  echo "## Probe Results"
  echo
  echo '```tsv'
  cat "$PROBE_LOG"
  echo '```'
} > "$SUMMARY"

if [[ "$reachable_count" -eq 0 ]]; then
  echo "No reachable QA endpoints detected from runner." | tee -a "$SUMMARY"
  exit 1
fi
