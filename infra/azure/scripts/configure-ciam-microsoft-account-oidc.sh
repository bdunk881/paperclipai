#!/usr/bin/env bash
# configure-ciam-microsoft-account-oidc.sh — Creates or updates the Microsoft
# Account OIDC identity provider in the CIAM tenant and attaches it to an
# external-user sign-up flow.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

required_envs=(
  CIAM_TENANT_ID
  CIAM_CLIENT_ID
  CIAM_CLIENT_SECRET
  MSA_FEDERATION_CLIENT_ID
  MSA_FEDERATION_CLIENT_SECRET
)

for var in "${required_envs[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo -e "${RED}Error:${NC} $var is required."
    exit 1
  fi
done

TARGET_USER_FLOW_ID="${TARGET_USER_FLOW_ID:-}"
TARGET_USER_FLOW_NAME="${TARGET_USER_FLOW_NAME:-AutoFlow}"
OIDC_PROVIDER_DISPLAY_NAME="${OIDC_PROVIDER_DISPLAY_NAME:-Microsoft Account}"
WELL_KNOWN_ENDPOINT="https://login.microsoftonline.com/consumers/v2.0/.well-known/openid-configuration"
ISSUER_URI="https://login.live.com"
SCOPE="openid profile email"

echo "=== AutoFlow CIAM Microsoft Account OIDC ==="
echo "  Tenant: $CIAM_TENANT_ID"
echo "  Provider display name: $OIDC_PROVIDER_DISPLAY_NAME"
echo ""

GRAPH_RESPONSE=$(
  curl -sS -X POST "https://login.microsoftonline.com/$CIAM_TENANT_ID/oauth2/v2.0/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "client_id=$CIAM_CLIENT_ID" \
    --data-urlencode "client_secret=$CIAM_CLIENT_SECRET" \
    --data-urlencode "scope=https://graph.microsoft.com/.default" \
    --data-urlencode "grant_type=client_credentials"
)

GRAPH_TOKEN=$(printf '%s' "$GRAPH_RESPONSE" | jq -r '.access_token // empty')
if [ -z "$GRAPH_TOKEN" ]; then
  echo -e "${RED}Failed to authenticate to Microsoft Graph.${NC}"
  printf '%s\n' "$GRAPH_RESPONSE"
  exit 1
fi

FLOWS_JSON=$(curl -sS -H "Authorization: Bearer $GRAPH_TOKEN" \
  "https://graph.microsoft.com/v1.0/identity/authenticationEventsFlows")

if [ -z "$TARGET_USER_FLOW_ID" ]; then
  TARGET_USER_FLOW_ID=$(FLOW_NAME="$TARGET_USER_FLOW_NAME" FLOWS_JSON="$FLOWS_JSON" python3 - <<'PY'
import json
import os

flows = json.loads(os.environ["FLOWS_JSON"]).get("value", [])
target = os.environ["FLOW_NAME"].strip().lower()
for flow in flows:
    if str(flow.get("displayName", "")).strip().lower() == target:
        print(flow["id"])
        break
PY
)
fi

if [ -z "$TARGET_USER_FLOW_ID" ]; then
  echo -e "${RED}Could not resolve the target user flow.${NC}"
  echo "Available flows:"
  printf '%s' "$FLOWS_JSON" | jq -r '.value[] | "  - \(.displayName) (\(.id))"'
  exit 1
fi

echo "Using user flow: $TARGET_USER_FLOW_ID"

PROVIDERS_JSON=$(curl -sS -H "Authorization: Bearer $GRAPH_TOKEN" \
  "https://graph.microsoft.com/beta/identity/identityProviders")

EXISTING_PROVIDER_ID=$(
  DISPLAY_NAME="$OIDC_PROVIDER_DISPLAY_NAME" PROVIDERS_JSON="$PROVIDERS_JSON" python3 - <<'PY'
import json
import os

providers = json.loads(os.environ["PROVIDERS_JSON"]).get("value", [])
target = os.environ["DISPLAY_NAME"].strip().lower()
for provider in providers:
    if str(provider.get("displayName", "")).strip().lower() == target:
        print(provider["id"])
        break
PY
)

PAYLOAD=$(jq -n \
  --arg displayName "$OIDC_PROVIDER_DISPLAY_NAME" \
  --arg clientId "$MSA_FEDERATION_CLIENT_ID" \
  --arg clientSecret "$MSA_FEDERATION_CLIENT_SECRET" \
  --arg issuer "$ISSUER_URI" \
  --arg wellKnownEndpoint "$WELL_KNOWN_ENDPOINT" \
  --arg scope "$SCOPE" \
  '{
    "@odata.type": "#microsoft.graph.oidcIdentityProvider",
    displayName: $displayName,
    clientId: $clientId,
    issuer: $issuer,
    wellKnownEndpoint: $wellKnownEndpoint,
    responseType: "code",
    scope: $scope,
    clientAuthentication: {
      "@odata.type": "#microsoft.graph.oidcClientSecretAuthentication",
      clientSecret: $clientSecret
    }
  }')

if [ -z "$EXISTING_PROVIDER_ID" ]; then
  echo "Creating Microsoft Account OIDC provider..."
  CREATE_RESPONSE=$(curl -sS -X POST \
    -H "Authorization: Bearer $GRAPH_TOKEN" \
    -H "Content-Type: application/json" \
    "https://graph.microsoft.com/beta/identity/identityProviders" \
    -d "$PAYLOAD")
  PROVIDER_ID=$(printf '%s' "$CREATE_RESPONSE" | jq -r '.id // empty')
  if [ -z "$PROVIDER_ID" ]; then
    echo -e "${RED}Failed to create the OIDC identity provider.${NC}"
    printf '%s\n' "$CREATE_RESPONSE"
    exit 1
  fi
else
  PROVIDER_ID="$EXISTING_PROVIDER_ID"
  echo "Updating existing provider: $PROVIDER_ID"
  curl -sS -X PATCH \
    -H "Authorization: Bearer $GRAPH_TOKEN" \
    -H "Content-Type: application/json" \
    "https://graph.microsoft.com/beta/identity/identityProviders/$PROVIDER_ID" \
    -d "$PAYLOAD" >/dev/null
fi

FLOW_PROVIDERS_JSON=$(curl -sS -H "Authorization: Bearer $GRAPH_TOKEN" \
  "https://graph.microsoft.com/v1.0/identity/authenticationEventsFlows/${TARGET_USER_FLOW_ID}/microsoft.graph.externalUsersSelfServiceSignUpEventsFlow/onAuthenticationMethodLoadStart/microsoft.graph.onAuthenticationMethodLoadStartExternalUsersSelfServiceSignUp/identityProviders")

ALREADY_ATTACHED=$(
  PROVIDER_ID="$PROVIDER_ID" FLOW_PROVIDERS_JSON="$FLOW_PROVIDERS_JSON" python3 - <<'PY'
import json
import os

provider_id = os.environ["PROVIDER_ID"]
providers = json.loads(os.environ["FLOW_PROVIDERS_JSON"]).get("value", [])
print("yes" if any(p.get("id") == provider_id for p in providers) else "")
PY
)

if [ -z "$ALREADY_ATTACHED" ]; then
  echo "Attaching provider to flow..."
  curl -sS -X POST \
    -H "Authorization: Bearer $GRAPH_TOKEN" \
    -H "Content-Type: application/json" \
    "https://graph.microsoft.com/v1.0/identity/authenticationEventsFlows/${TARGET_USER_FLOW_ID}/microsoft.graph.externalUsersSelfServiceSignUpEventsFlow/onAuthenticationMethodLoadStart/microsoft.graph.onAuthenticationMethodLoadStartExternalUsersSelfServiceSignUp/identityProviders/\$ref" \
    -d "{\"@odata.id\":\"https://graph.microsoft.com/v1.0/identityProviders/${PROVIDER_ID}\"}" >/dev/null
fi

echo -e "${GREEN}Configured.${NC} Provider $PROVIDER_ID is available on flow $TARGET_USER_FLOW_ID."
