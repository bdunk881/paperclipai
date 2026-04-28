#!/usr/bin/env bash
# verify-ciam-policy-grant.sh — Verifies that the CIAM service principal
# has been granted Policy.ReadWrite.AuthenticationMethod on Microsoft Graph.
#
# Can run with either:
#   A) SP credentials (CIAM_CLIENT_ID + CIAM_CLIENT_SECRET + CIAM_TENANT_ID), or
#   B) Azure CLI admin session (az login --tenant $CIAM_TENANT_ID)
#
# Usage:
#   # Option A: SP credentials
#   CIAM_TENANT_ID=... CIAM_CLIENT_ID=... CIAM_CLIENT_SECRET=... ./verify-ciam-policy-grant.sh
#
#   # Option B: Azure CLI (no secret needed)
#   az login --tenant $CIAM_TENANT_ID
#   CIAM_TENANT_ID=... CIAM_CLIENT_ID=... ./verify-ciam-policy-grant.sh

set -euo pipefail

CIAM_TENANT_ID="${CIAM_TENANT_ID:?CIAM_TENANT_ID is required}"
CIAM_CLIENT_ID="${CIAM_CLIENT_ID:?CIAM_CLIENT_ID is required}"
CIAM_CLIENT_SECRET="${CIAM_CLIENT_SECRET:-}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

MSGRAPH_APP_ID="00000003-0000-0000-c000-000000000000"
PERMISSION_VALUE="Policy.ReadWrite.AuthenticationMethod"

echo "=== Verify CIAM SP Graph Permissions ==="
echo "  Tenant:    $CIAM_TENANT_ID"
echo "  Client ID: $CIAM_CLIENT_ID"
echo ""

# ── Determine auth method ──────────────────────────────────────────────────
USE_AZ_CLI="no"

if [ -n "$CIAM_CLIENT_SECRET" ]; then
  echo "Using SP credentials for authentication..."
  TOKEN_RESPONSE=$(curl -s -X POST \
    "https://login.microsoftonline.com/$CIAM_TENANT_ID/oauth2/v2.0/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "client_id=$CIAM_CLIENT_ID" \
    --data-urlencode "client_secret=$CIAM_CLIENT_SECRET" \
    --data-urlencode "scope=https://graph.microsoft.com/.default" \
    --data-urlencode "grant_type=client_credentials")

  GRAPH_TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('access_token', ''))
" 2>/dev/null || echo "")

  if [ -z "$GRAPH_TOKEN" ]; then
    echo -e "${YELLOW}SP authentication failed, falling back to Azure CLI...${NC}"
    USE_AZ_CLI="yes"
  else
    echo -e "${GREEN}Authenticated via SP credentials.${NC}"
  fi
else
  USE_AZ_CLI="yes"
fi

if [ "$USE_AZ_CLI" = "yes" ]; then
  echo "Using Azure CLI for authentication..."
  GRAPH_TOKEN=$(az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv 2>/dev/null || echo "")
  if [ -z "$GRAPH_TOKEN" ]; then
    echo -e "${RED}Failed to get Graph token via Azure CLI.${NC}"
    echo "Run: az login --tenant $CIAM_TENANT_ID"
    exit 1
  fi
  echo -e "${GREEN}Authenticated via Azure CLI.${NC}"
fi

# ── Resolve SP object ID ──────────────────────────────────────────────────
echo ""
echo "Resolving service principal..."
SP_RESPONSE=$(curl -s -H "Authorization: Bearer $GRAPH_TOKEN" \
  "https://graph.microsoft.com/v1.0/servicePrincipals?\$filter=appId%20eq%20'$CIAM_CLIENT_ID'&\$select=id,appId,displayName")

CIAM_SP_ID=$(echo "$SP_RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
vals = d.get('value', [])
print(vals[0]['id'] if vals else '')
" 2>/dev/null || echo "")

SP_NAME=$(echo "$SP_RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
vals = d.get('value', [])
print(vals[0].get('displayName', 'unknown') if vals else 'unknown')
" 2>/dev/null || echo "unknown")

if [ -z "$CIAM_SP_ID" ]; then
  echo -e "${RED}Service principal not found for appId $CIAM_CLIENT_ID${NC}"
  exit 1
fi
echo -e "${GREEN}SP: $SP_NAME ($CIAM_SP_ID)${NC}"

# ── Resolve the expected role ID ──────────────────────────────────────────
echo ""
echo "Resolving $PERMISSION_VALUE role ID from Graph SP..."
MSGRAPH_RESPONSE=$(curl -s -H "Authorization: Bearer $GRAPH_TOKEN" \
  "https://graph.microsoft.com/v1.0/servicePrincipals?\$filter=appId%20eq%20'$MSGRAPH_APP_ID'&\$select=id,appRoles")

EXPECTED_ROLE_ID=$(echo "$MSGRAPH_RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
vals = d.get('value', [])
app_roles = vals[0].get('appRoles', []) if vals else []
for role in app_roles:
    if role.get('value') == '$PERMISSION_VALUE':
        print(role.get('id', ''))
        break
else:
    print('')
" 2>/dev/null || echo "")

if [ -z "$EXPECTED_ROLE_ID" ]; then
  echo -e "${RED}Could not resolve role ID for $PERMISSION_VALUE${NC}"
  exit 1
fi
echo "Expected role ID: $EXPECTED_ROLE_ID"

# ── Check app role assignments ────────────────────────────────────────────
echo ""
echo "Checking app role assignments..."
NEXT_URL="https://graph.microsoft.com/v1.0/servicePrincipals/$CIAM_SP_ID/appRoleAssignments"
FOUND="no"

while [ -n "$NEXT_URL" ] && [ "$FOUND" = "no" ]; do
  PAGE=$(curl -s -H "Authorization: Bearer $GRAPH_TOKEN" "$NEXT_URL")

  FOUND=$(echo "$PAGE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
target = '$EXPECTED_ROLE_ID'
for a in d.get('value', []):
    if a.get('appRoleId') == target:
        print('yes')
        break
else:
    print('no')
" 2>/dev/null || echo "no")

  NEXT_URL=$(echo "$PAGE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('@odata.nextLink', ''))
" 2>/dev/null || echo "")
done

echo ""
echo "=== Result ==="
if [ "$FOUND" = "yes" ]; then
  echo -e "${GREEN}PASS: $PERMISSION_VALUE is granted to $SP_NAME.${NC}"
  echo "The CIAM SP can update authenticationMethodsPolicy."
  exit 0
else
  echo -e "${RED}FAIL: $PERMISSION_VALUE is NOT granted to $SP_NAME.${NC}"
  echo ""
  echo "To fix, run as a CIAM tenant Global Administrator:"
  echo "  ./grant-ciam-policy-admin-consent.sh"
  exit 1
fi
