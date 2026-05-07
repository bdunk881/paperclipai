#!/usr/bin/env bash
# Smoke-test a Cloudflare Pages deployment URL.
# Usage: cloudflare_pages_smoke.sh <project_label> <url>
# Exits 0 if the URL returns a non-error HTTP status, 1 otherwise.
set -euo pipefail

PROJECT="${1:-unknown}"
URL="${2:-}"

if [[ -z "$URL" ]]; then
  echo "::error::cloudflare_pages_smoke.sh: URL argument is required"
  exit 1
fi

MAX_ATTEMPTS=6
SLEEP_SECS=10

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  HTTP_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 15 "$URL" || echo "000")

  echo "[$PROJECT] attempt $attempt/$MAX_ATTEMPTS → $URL → HTTP $HTTP_STATUS"

  if [[ "$HTTP_STATUS" =~ ^[2345][0-9][0-9]$ ]]; then
    echo "[$PROJECT] smoke test passed (HTTP $HTTP_STATUS)"
    exit 0
  fi

  if [[ "$attempt" -lt "$MAX_ATTEMPTS" ]]; then
    echo "[$PROJECT] not ready yet; retrying in ${SLEEP_SECS}s..."
    sleep "$SLEEP_SECS"
  fi
done

echo "::error::[$PROJECT] smoke test failed after $MAX_ATTEMPTS attempts — $URL unreachable"
exit 1
