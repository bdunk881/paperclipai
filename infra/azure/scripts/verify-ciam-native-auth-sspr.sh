#!/usr/bin/env bash
# verify-ciam-native-auth-sspr.sh — Exercises the native auth password-reset
# start endpoint and fails if Azure still returns AADSTS500222.
#
# Required env vars:
#   CIAM_TENANT_ID
#   CIAM_TENANT_SUBDOMAIN
#   TARGET_APP_CLIENT_ID
#   CIAM_TEST_USERNAME
#
# Optional env vars:
#   CIAM_CHALLENGE_TYPE  — defaults to "oob redirect"
#
# Usage:
#   ./verify-ciam-native-auth-sspr.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

required_envs=(CIAM_TENANT_ID CIAM_TENANT_SUBDOMAIN TARGET_APP_CLIENT_ID CIAM_TEST_USERNAME)
for var in "${required_envs[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo -e "${RED}Error:${NC} $var is required."
    exit 1
  fi
done

CIAM_CHALLENGE_TYPE="${CIAM_CHALLENGE_TYPE:-oob redirect}"
START_URL="https://${CIAM_TENANT_SUBDOMAIN}.ciamlogin.com/${CIAM_TENANT_ID}/resetpassword/v1.0/start"

echo "=== AutoFlow CIAM Native Auth SSPR Verification ==="
echo "  URL: $START_URL"
echo "  Username: $CIAM_TEST_USERNAME"
echo ""

HTTP_STATUS=$(curl -sS -o /tmp/autoflow-ciam-sspr-verify-response.json -w "%{http_code}" \
  -X POST "$START_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Accept: application/json" \
  --data-urlencode "client_id=$TARGET_APP_CLIENT_ID" \
  --data-urlencode "username=$CIAM_TEST_USERNAME" \
  --data-urlencode "challenge_type=$CIAM_CHALLENGE_TYPE")

if [ "$HTTP_STATUS" -ge 400 ]; then
  echo -e "${RED}Endpoint returned HTTP $HTTP_STATUS.${NC}"
  cat /tmp/autoflow-ciam-sspr-verify-response.json
  exit 1
fi

VERIFY_RESULT=$(python3 - <<'PY'
import json
import sys

with open("/tmp/autoflow-ciam-sspr-verify-response.json", "r", encoding="utf-8") as handle:
    payload = json.load(handle)

continuation = payload.get("continuation_token")
error = (payload.get("error") or "").strip()
description = (payload.get("error_description") or "").strip()

if continuation:
    print("success")
    print(continuation)
    sys.exit(0)

if "AADSTS500222" in description or "native credential recovery" in description:
    print("aadsts500222")
    print(description)
    sys.exit(0)

if error or description:
    print("other_error")
    print(error or description)
    sys.exit(0)

print("unknown")
print(json.dumps(payload))
PY
)

RESULT_KIND=$(printf '%s\n' "$VERIFY_RESULT" | sed -n '1p')
RESULT_DETAIL=$(printf '%s\n' "$VERIFY_RESULT" | sed -n '2p')

case "$RESULT_KIND" in
  success)
    echo -e "${GREEN}Verified.${NC} resetpassword/v1.0/start returned a continuation token."
    echo "  continuation_token: ${RESULT_DETAIL:0:24}..."
    ;;
  aadsts500222)
    echo -e "${RED}SSPR is still not active for native auth.${NC}"
    echo "  Azure response: $RESULT_DETAIL"
    exit 1
    ;;
  other_error)
    echo -e "${YELLOW}Password reset start returned an error unrelated to AADSTS500222.${NC}"
    echo "  Response: $RESULT_DETAIL"
    exit 1
    ;;
  *)
    echo -e "${YELLOW}Password reset start returned an unexpected payload.${NC}"
    cat /tmp/autoflow-ciam-sspr-verify-response.json
    exit 1
    ;;
esac
