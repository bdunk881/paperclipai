#!/usr/bin/env bash
# enable-ciam-native-auth-sspr.sh — Enables Email OTP SSPR for an Entra
# External ID tenant so the native-auth resetpassword/v1.0/* endpoints stop
# returning AADSTS500222.
#
# Required env vars:
#   CIAM_TENANT_ID
#   CIAM_CLIENT_ID
#   CIAM_CLIENT_SECRET
#
# Optional env vars:
#   CIAM_SSPR_INCLUDE_GROUP_ID   — if set, target Email OTP to this group
#   CIAM_SSPR_EXCLUDE_GROUP_ID   — if set, exclude this group from Email OTP
#
# Usage:
#   ./enable-ciam-native-auth-sspr.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

required_envs=(CIAM_TENANT_ID CIAM_CLIENT_ID CIAM_CLIENT_SECRET)
for var in "${required_envs[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo -e "${RED}Error:${NC} $var is required."
    exit 1
  fi
done

echo "=== AutoFlow CIAM Native Auth SSPR Enablement ==="
echo "  Tenant ID: $CIAM_TENANT_ID"
echo ""

GRAPH_RESPONSE=$(curl -sS -X POST "https://login.microsoftonline.com/$CIAM_TENANT_ID/oauth2/v2.0/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=$CIAM_CLIENT_ID" \
  -d "client_secret=$CIAM_CLIENT_SECRET" \
  -d "scope=https://graph.microsoft.com/.default" \
  -d "grant_type=client_credentials")

GRAPH_TOKEN=$(printf '%s' "$GRAPH_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || echo "")

if [ -z "$GRAPH_TOKEN" ]; then
  echo -e "${RED}Failed to authenticate to Microsoft Graph.${NC}"
  printf '%s\n' "$GRAPH_RESPONSE"
  exit 1
fi

CONFIG_JSON=$(curl -sS -H "Authorization: Bearer $GRAPH_TOKEN" \
  "https://graph.microsoft.com/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/email")

PATCH_BODY=$(CONFIG_JSON="$CONFIG_JSON" \
  CIAM_SSPR_INCLUDE_GROUP_ID="${CIAM_SSPR_INCLUDE_GROUP_ID:-}" \
  CIAM_SSPR_EXCLUDE_GROUP_ID="${CIAM_SSPR_EXCLUDE_GROUP_ID:-}" \
  python3 - <<'PY'
import json
import os

config = json.loads(os.environ["CONFIG_JSON"])

payload = {
    "@odata.type": "#microsoft.graph.emailAuthenticationMethodConfiguration",
    "state": "enabled",
    "allowExternalIdToUseEmailOtp": "enabled",
}

include_group = os.environ.get("CIAM_SSPR_INCLUDE_GROUP_ID", "").strip()
exclude_group = os.environ.get("CIAM_SSPR_EXCLUDE_GROUP_ID", "").strip()

if include_group:
    payload["includeTargets"] = [
        {
            "@odata.type": "#microsoft.graph.authenticationMethodTarget",
            "id": include_group,
            "targetType": "group",
            "isRegistrationRequired": False,
        }
    ]
elif "includeTargets" in config:
    payload["includeTargets"] = config["includeTargets"]

if exclude_group:
    payload["excludeTargets"] = [
        {
            "@odata.type": "#microsoft.graph.excludeTarget",
            "id": exclude_group,
            "targetType": "group",
        }
    ]
elif "excludeTargets" in config:
    payload["excludeTargets"] = config["excludeTargets"]

print(json.dumps(payload))
PY
)

HTTP_STATUS=$(curl -sS -o /tmp/autoflow-ciam-sspr-enable-response.json -w "%{http_code}" -X PATCH \
  -H "Authorization: Bearer $GRAPH_TOKEN" \
  -H "Content-Type: application/json" \
  "https://graph.microsoft.com/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/email" \
  -d "$PATCH_BODY")

if [ "$HTTP_STATUS" != "204" ]; then
  echo -e "${RED}Failed to enable Email OTP SSPR (HTTP $HTTP_STATUS).${NC}"
  cat /tmp/autoflow-ciam-sspr-enable-response.json
  exit 1
fi

UPDATED_CONFIG=$(curl -sS -H "Authorization: Bearer $GRAPH_TOKEN" \
  "https://graph.microsoft.com/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/email")

echo -e "${GREEN}Enabled.${NC}"
echo ""
UPDATED_CONFIG="$UPDATED_CONFIG" python3 - <<'PY'
import json
import os

config = json.loads(os.environ["UPDATED_CONFIG"])
print("Current Email OTP policy:")
print(f"  state: {config.get('state')}")
print(f"  allowExternalIdToUseEmailOtp: {config.get('allowExternalIdToUseEmailOtp')}")

include_targets = config.get("includeTargets") or []
exclude_targets = config.get("excludeTargets") or []

if include_targets:
    print("  includeTargets:")
    for target in include_targets:
        print(f"    - {target.get('targetType')} {target.get('id')}")
else:
    print("  includeTargets: [] (tenant default / all targeted users)")

if exclude_targets:
    print("  excludeTargets:")
    for target in exclude_targets:
        print(f"    - {target.get('targetType')} {target.get('id')}")
else:
    print("  excludeTargets: []")
PY

echo ""
echo "Next step:"
echo "  Run ./verify-ciam-native-auth-sspr.sh with CIAM_TENANT_SUBDOMAIN, TARGET_APP_CLIENT_ID,"
echo "  and CIAM_TEST_USERNAME to confirm resetpassword/v1.0/start now returns a continuation token."
