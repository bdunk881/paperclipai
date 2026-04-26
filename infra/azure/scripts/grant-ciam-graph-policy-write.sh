#!/usr/bin/env bash
# grant-ciam-graph-policy-write.sh — Grants the CIAM service principal
# the Policy.ReadWrite.AuthenticationMethod application permission on
# Microsoft Graph so it can update authenticationMethodsPolicy (e.g.
# enable Email OTP for SSPR in native auth flows).
#
# Required env vars:
#   CIAM_TENANT_ID     — Tenant ID of the CIAM directory
#   CIAM_CLIENT_ID     — App (client) ID of the service principal in the CIAM tenant
#   CIAM_CLIENT_SECRET — Client secret for the above SP
#
# The calling SP must already hold sufficient Graph permissions to create
# appRoleAssignments (typically Directory.ReadWrite.All or Global Administrator
# role in the CIAM tenant).
#
# Usage: ./grant-ciam-graph-policy-write.sh

set -euo pipefail

CIAM_TENANT_ID="${CIAM_TENANT_ID:?CIAM_TENANT_ID is required}"
CIAM_CLIENT_ID="${CIAM_CLIENT_ID:?CIAM_CLIENT_ID is required}"
CIAM_CLIENT_SECRET="${CIAM_CLIENT_SECRET:?CIAM_CLIENT_SECRET is required}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Well-known IDs
MSGRAPH_APP_ID="00000003-0000-0000-c000-000000000000"
# Policy.ReadWrite.AuthenticationMethod application permission GUID
POLICY_RW_AUTH_METHOD_ROLE_ID="29c18626-4571-4f1a-9571-00e0d22b9fac"

echo "=== Grant CIAM SP Policy.ReadWrite.AuthenticationMethod ==="
echo "  Tenant: $CIAM_TENANT_ID"
echo "  Client: $CIAM_CLIENT_ID"
echo ""

# ── 1. Authenticate to CIAM tenant ──────────────────────────────────────────
echo "Authenticating to CIAM tenant..."
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
  echo -e "${RED}Failed to authenticate.${NC}"
  echo "$TOKEN_RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('error_description', 'unknown error')[:300])
" 2>/dev/null || echo "$TOKEN_RESPONSE"
  exit 1
fi
echo -e "${GREEN}Authenticated.${NC}"

# ── 2. Resolve the CIAM SP object ID (servicePrincipal for our app) ─────────
echo ""
echo "Resolving service principal object ID for $CIAM_CLIENT_ID..."
SP_RESPONSE=$(curl -s -H "Authorization: Bearer $GRAPH_TOKEN" \
  "https://graph.microsoft.com/v1.0/servicePrincipals?\$filter=appId%20eq%20'$CIAM_CLIENT_ID'&\$select=id,appId,displayName")

CIAM_SP_ID=$(echo "$SP_RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
vals = d.get('value', [])
print(vals[0]['id'] if vals else '')
" 2>/dev/null || echo "")

if [ -z "$CIAM_SP_ID" ]; then
  echo -e "${RED}Could not find service principal for appId $CIAM_CLIENT_ID${NC}"
  echo "$SP_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$SP_RESPONSE"
  exit 1
fi
echo -e "${GREEN}Found SP: $CIAM_SP_ID${NC}"

# ── 3. Resolve the Microsoft Graph service principal in the CIAM tenant ─────
echo ""
echo "Resolving Microsoft Graph service principal..."
MSGRAPH_RESPONSE=$(curl -s -H "Authorization: Bearer $GRAPH_TOKEN" \
  "https://graph.microsoft.com/v1.0/servicePrincipals?\$filter=appId%20eq%20'$MSGRAPH_APP_ID'&\$select=id,appId,displayName")

MSGRAPH_SP_ID=$(echo "$MSGRAPH_RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
vals = d.get('value', [])
print(vals[0]['id'] if vals else '')
" 2>/dev/null || echo "")

if [ -z "$MSGRAPH_SP_ID" ]; then
  echo -e "${RED}Could not find Microsoft Graph service principal in CIAM tenant.${NC}"
  echo "This usually means the Graph SP hasn't been provisioned in this tenant."
  echo "Try: az ad sp create --id $MSGRAPH_APP_ID  (while targeting the CIAM tenant)"
  exit 1
fi
echo -e "${GREEN}Graph SP: $MSGRAPH_SP_ID${NC}"

# ── 4. Check if the permission is already granted (follows pagination) ──────
echo ""
echo "Checking existing app role assignments..."
NEXT_URL="https://graph.microsoft.com/v1.0/servicePrincipals/$CIAM_SP_ID/appRoleAssignments"
ALREADY_GRANTED="no"

while [ -n "$NEXT_URL" ] && [ "$ALREADY_GRANTED" = "no" ]; do
  PAGE_RESPONSE=$(curl -s -H "Authorization: Bearer $GRAPH_TOKEN" "$NEXT_URL")

  ALREADY_GRANTED=$(echo "$PAGE_RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
target = '$POLICY_RW_AUTH_METHOD_ROLE_ID'
for a in d.get('value', []):
    if a.get('appRoleId') == target:
        print('yes')
        break
else:
    print('no')
" 2>/dev/null || echo "no")

  NEXT_URL=$(echo "$PAGE_RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('@odata.nextLink', ''))
" 2>/dev/null || echo "")
done

if [ "$ALREADY_GRANTED" = "yes" ]; then
  echo -e "${GREEN}Policy.ReadWrite.AuthenticationMethod is already granted.${NC}"
  echo ""
  echo "No action needed. The CIAM SP can already update authentication methods policy."
  exit 0
fi

echo -e "${YELLOW}Not yet granted. Creating app role assignment...${NC}"

# ── 5. Grant the permission ─────────────────────────────────────────────────
echo ""
GRANT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $GRAPH_TOKEN" \
  -H "Content-Type: application/json" \
  "https://graph.microsoft.com/v1.0/servicePrincipals/$CIAM_SP_ID/appRoleAssignments" \
  -d "{
    \"principalId\": \"$CIAM_SP_ID\",
    \"resourceId\": \"$MSGRAPH_SP_ID\",
    \"appRoleId\": \"$POLICY_RW_AUTH_METHOD_ROLE_ID\"
  }")

HTTP_STATUS=$(echo "$GRANT_RESPONSE" | tail -1)
GRANT_BODY=$(echo "$GRANT_RESPONSE" | sed '$d')

if [ "$HTTP_STATUS" = "201" ] || [ "$HTTP_STATUS" = "200" ]; then
  echo -e "${GREEN}Successfully granted Policy.ReadWrite.AuthenticationMethod.${NC}"
  echo ""
  echo "Assignment details:"
  echo "$GRANT_BODY" | python3 -m json.tool 2>/dev/null || echo "$GRANT_BODY"
  echo ""
  echo "=== Next Steps ==="
  echo "The CIAM SP can now update authenticationMethodsPolicy."
  echo "Re-run enable-ciam-native-auth-sspr.sh to enable Email OTP for SSPR."
else
  echo -e "${RED}Failed to grant permission (HTTP $HTTP_STATUS).${NC}"
  echo ""
  echo "$GRANT_BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
err = d.get('error', {})
print(f\"Code: {err.get('code', 'unknown')}\")
print(f\"Message: {err.get('message', 'unknown')[:500]}\")
" 2>/dev/null || echo "$GRANT_BODY"
  echo ""
  echo "=== Troubleshooting ==="
  echo "If 'Authorization_RequestDenied' or 'Insufficient privileges':"
  echo "  The calling SP needs one of:"
  echo "    - AppRoleAssignment.ReadWrite.All (application permission)"
  echo "    - Directory.ReadWrite.All (application permission)"
  echo "    - Global Administrator directory role in the CIAM tenant"
  echo ""
  echo "If the SP lacks these, a tenant admin must grant the permission manually:"
  echo "  Azure Portal → CIAM tenant → App registrations → $CIAM_CLIENT_ID →"
  echo "  API permissions → + Add a permission → Microsoft Graph → Application →"
  echo "  Policy.ReadWrite.AuthenticationMethod → Grant admin consent"
  exit 1
fi
