#!/usr/bin/env bash
# sync-ciam-redirect-uris.sh — Upserts the redirect URIs required by the
# dashboard's current and in-flight MSAL redirect flows on an existing CIAM SPA app.
#
# Required env vars:
#   CIAM_TENANT_ID
#   CIAM_CLIENT_ID
#   CIAM_CLIENT_SECRET
#
# Optional env vars:
#   TARGET_APP_CLIENT_ID   — defaults to AutoFlow dashboard app registration
#   EXTRA_REDIRECT_URIS    — newline-delimited redirect URIs to preserve/add
#
# Usage:
#   ./sync-ciam-redirect-uris.sh
#
# Transition note:
#   During the ALT-1542 callback migration we intentionally register both the
#   host root and /auth/callback for production, staging, preview, and local
#   hosts so current prod and the upcoming auth-callback branch both work.

set -euo pipefail

TARGET_APP_CLIENT_ID="${TARGET_APP_CLIENT_ID:-2dfd3a08-277c-4893-b07d-eca5ae322310}"

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

echo "=== AutoFlow CIAM Redirect URI Sync ==="
echo "  App client ID: $TARGET_APP_CLIENT_ID"
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

APP_JSON=$(curl -sS -H "Authorization: Bearer $GRAPH_TOKEN" \
  "https://graph.microsoft.com/v1.0/applications?\$filter=appId%20eq%20'$TARGET_APP_CLIENT_ID'&\$select=id,displayName,spa")

APP_OBJECT_ID=$(APP_JSON="$APP_JSON" python3 -c "import json,os; obj=json.loads(os.environ['APP_JSON']); print(obj['value'][0]['id'] if obj.get('value') else '')")
APP_NAME=$(APP_JSON="$APP_JSON" python3 -c "import json,os; obj=json.loads(os.environ['APP_JSON']); print(obj['value'][0].get('displayName','') if obj.get('value') else '')")

if [ -z "$APP_OBJECT_ID" ]; then
  echo -e "${RED}Could not find app registration for client ID $TARGET_APP_CLIENT_ID.${NC}"
  exit 1
fi

PATCH_BODY=$(APP_JSON="$APP_JSON" EXTRA_REDIRECT_URIS="${EXTRA_REDIRECT_URIS:-}" python3 - <<'PY'
import json
import os

obj = json.loads(os.environ["APP_JSON"])
app = obj["value"][0]
current = app.get("spa", {}).get("redirectUris", [])
required = [
    "https://app.helloautoflow.com",
    "https://app.helloautoflow.com/auth/callback",
    "https://app.helloautoflow.com/login",
    "https://staging.app.helloautoflow.com",
    "https://staging.app.helloautoflow.com/auth/callback",
    "https://staging.app.helloautoflow.com/login",
    "https://dashboard-beta-one-42.vercel.app",
    "https://dashboard-beta-one-42.vercel.app/auth/callback",
    "https://dashboard-brad-duncans-projects.vercel.app",
    "https://dashboard-brad-duncans-projects.vercel.app/auth/callback",
    "https://dashboard-git-master-brad-duncans-projects.vercel.app",
    "https://dashboard-git-master-brad-duncans-projects.vercel.app/auth/callback",
    "http://localhost:3000",
    "http://localhost:3000/auth/callback",
    "http://localhost:5173",
    "http://localhost:5173/auth/callback",
    "http://localhost:5173/login",
]
extra = [line.strip() for line in os.environ.get("EXTRA_REDIRECT_URIS", "").splitlines() if line.strip()]

merged = []
seen = set()
for uri in current + required + extra:
    normalized = uri.strip()
    key = normalized.lower().rstrip("/") if normalized.lower().startswith("http") else normalized
    if not normalized or key in seen:
        continue
    seen.add(key)
    merged.append(normalized)

print(json.dumps({"spa": {"redirectUris": merged}}))
PY
)

HTTP_STATUS=$(curl -sS -o /tmp/autoflow-ciam-sync-response.json -w "%{http_code}" -X PATCH \
  -H "Authorization: Bearer $GRAPH_TOKEN" \
  -H "Content-Type: application/json" \
  "https://graph.microsoft.com/v1.0/applications/$APP_OBJECT_ID" \
  -d "$PATCH_BODY")

if [ "$HTTP_STATUS" != "204" ]; then
  echo -e "${RED}Failed to patch redirect URIs (HTTP $HTTP_STATUS).${NC}"
  cat /tmp/autoflow-ciam-sync-response.json
  exit 1
fi

echo -e "${GREEN}Updated:${NC} $APP_NAME"
echo ""
echo "Registered SPA redirect URIs:"
curl -sS -H "Authorization: Bearer $GRAPH_TOKEN" \
  "https://graph.microsoft.com/v1.0/applications/$APP_OBJECT_ID?\$select=spa" \
  | python3 -c "import sys,json; [print(f'  - {uri}') for uri in json.load(sys.stdin).get('spa',{}).get('redirectUris',[])]"
