#!/usr/bin/env bash
# grant-ciam-graph-permissions.sh — Grants OrganizationalBranding.ReadWrite.All
# and Domain.ReadWrite.All to the existing CIAM automation app, then triggers
# admin consent.
#
# Prerequisites:
#   - Caller must be a Global Administrator in the CIAM tenant
#   - az cli logged in to the CIAM tenant:
#       az login --tenant 5e4f1080-8afc-4005-b05e-32b21e69363a
#
# Required env vars:
#   CIAM_TENANT_ID  — CIAM tenant ID (default: 5e4f1080-8afc-4005-b05e-32b21e69363a)
#   CIAM_APP_ID     — existing CIAM app object ID (default: f0c4b48e-9052-43d6-a3e6-c5c65ba18ad7)
#
# Usage: ./grant-ciam-graph-permissions.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

CIAM_TENANT_ID="${CIAM_TENANT_ID:-5e4f1080-8afc-4005-b05e-32b21e69363a}"
CIAM_APP_ID="${CIAM_APP_ID:-f0c4b48e-9052-43d6-a3e6-c5c65ba18ad7}"

# Microsoft Graph service principal well-known appId
GRAPH_APP_ID="00000003-0000-0000-c000-000000000000"

# Permission IDs (from Microsoft Graph permission reference)
# OrganizationalBranding.ReadWrite.All (application)
BRANDING_PERMISSION_ID="3b55498e-39fc-4e60-8ded-e34c5702832a"
# Domain.ReadWrite.All (application)
DOMAIN_PERMISSION_ID="7e05723c-0bb0-42da-be95-18addd1d6571"

echo "=== Grant CIAM Graph Permissions ==="
echo ""
echo "Tenant:  $CIAM_TENANT_ID"
echo "App:     $CIAM_APP_ID"
echo ""

# 1. Get an admin Graph token for the CIAM tenant
info "Acquiring Graph token via az cli (must be logged in as Global Admin)..."
GRAPH_TOKEN=$(az account get-access-token \
  --resource https://graph.microsoft.com \
  --tenant "$CIAM_TENANT_ID" \
  --query accessToken -o tsv 2>/dev/null) || fail "Failed to get Graph token. Are you logged in as a Global Admin in the CIAM tenant?"
pass "Graph token acquired"

# 2. Find the Microsoft Graph service principal in the CIAM tenant
info "Looking up Microsoft Graph service principal in CIAM tenant..."
GRAPH_SP_ID=$(curl -sS -H "Authorization: Bearer $GRAPH_TOKEN" \
  "https://graph.microsoft.com/v1.0/servicePrincipals?\$filter=appId%20eq%20'$GRAPH_APP_ID'&\$select=id" \
  | python3 -c "import sys,json; v=json.load(sys.stdin).get('value',[]); print(v[0]['id'] if v else '')" 2>/dev/null)

if [ -z "$GRAPH_SP_ID" ]; then
  fail "Microsoft Graph service principal not found in CIAM tenant"
fi
pass "Graph SP found: $GRAPH_SP_ID"

# 3. Find the CIAM app's service principal
info "Looking up CIAM app service principal..."
APP_SP_ID=$(curl -sS -H "Authorization: Bearer $GRAPH_TOKEN" \
  "https://graph.microsoft.com/v1.0/servicePrincipals?\$filter=appId%20eq%20'$CIAM_APP_ID'&\$select=id" \
  | python3 -c "import sys,json; v=json.load(sys.stdin).get('value',[]); print(v[0]['id'] if v else '')" 2>/dev/null)

if [ -z "$APP_SP_ID" ]; then
  info "Service principal not found for app $CIAM_APP_ID — creating it..."
  APP_SP_ID=$(curl -sS -X POST -H "Authorization: Bearer $GRAPH_TOKEN" \
    -H "Content-Type: application/json" \
    "https://graph.microsoft.com/v1.0/servicePrincipals" \
    -d "{\"appId\": \"$CIAM_APP_ID\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
  if [ -z "$APP_SP_ID" ]; then
    fail "Could not create service principal for app $CIAM_APP_ID"
  fi
  pass "Service principal created: $APP_SP_ID"
else
  pass "App SP found: $APP_SP_ID"
fi

# 4. Grant app role assignments (this is the admin consent step)
grant_permission() {
  local PERM_ID=$1
  local PERM_NAME=$2

  info "Granting $PERM_NAME ($PERM_ID)..."

  RESPONSE=$(curl -sS -w "\n%{http_code}" -X POST -H "Authorization: Bearer $GRAPH_TOKEN" \
    -H "Content-Type: application/json" \
    "https://graph.microsoft.com/v1.0/servicePrincipals/$APP_SP_ID/appRoleAssignments" \
    -d "{
      \"principalId\": \"$APP_SP_ID\",
      \"resourceId\": \"$GRAPH_SP_ID\",
      \"appRoleId\": \"$PERM_ID\"
    }" 2>/dev/null)

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" = "201" ]; then
    pass "$PERM_NAME granted successfully"
  elif [ "$HTTP_CODE" = "409" ]; then
    pass "$PERM_NAME already granted (conflict/duplicate)"
  else
    ERROR_MSG=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',{}).get('message','unknown'))" 2>/dev/null || echo "HTTP $HTTP_CODE")
    fail "Failed to grant $PERM_NAME: $ERROR_MSG"
  fi
}

echo ""
grant_permission "$BRANDING_PERMISSION_ID" "OrganizationalBranding.ReadWrite.All"
grant_permission "$DOMAIN_PERMISSION_ID" "Domain.ReadWrite.All"

# 5. Verify by listing current app role assignments
echo ""
info "Verifying current permissions..."
ASSIGNMENTS=$(curl -sS -H "Authorization: Bearer $GRAPH_TOKEN" \
  "https://graph.microsoft.com/v1.0/servicePrincipals/$APP_SP_ID/appRoleAssignments" 2>/dev/null)

echo "$ASSIGNMENTS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
roles = data.get('value', [])
print(f'  Total app role assignments: {len(roles)}')
for r in roles:
    print(f'  - {r.get(\"appRoleId\",\"?\")} -> {r.get(\"resourceDisplayName\",\"?\")}')
" 2>/dev/null || echo "  (could not parse assignments)"

echo ""
echo "=== Done ==="
echo ""
echo "Next steps:"
echo "  1. Run validate-ciam-prereqs.sh with CIAM credentials to confirm"
echo "  2. DevOps can proceed with branding + domain automation on ALT-1648"
