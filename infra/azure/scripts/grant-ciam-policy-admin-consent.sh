#!/usr/bin/env bash
# grant-ciam-policy-admin-consent.sh — Grants Policy.ReadWrite.AuthenticationMethod
# to the CIAM service principal using a tenant admin's Azure CLI session.
#
# This script is the admin-consent companion to grant-ciam-graph-policy-write.sh.
# Use it when the automation SP lacks AppRoleAssignment.ReadWrite.All and cannot
# self-assign the permission (HTTP 403 Authorization_RequestDenied).
#
# Prerequisites:
#   - Azure CLI (`az`) installed and logged in as a Global Administrator
#     of the CIAM tenant
#   - The admin must target the CIAM tenant:
#       az login --tenant <CIAM_TENANT_ID>
#
# Required env vars:
#   CIAM_TENANT_ID — Tenant ID of the CIAM directory (e.g. 5e4f1080-8afc-4005-b05e-32b21e69363a)
#   CIAM_CLIENT_ID — App (client) ID of the service principal (e.g. f0c4b48e-9052-43d6-a3e6-c5c65ba18ad7)
#
# Usage:
#   az login --tenant $CIAM_TENANT_ID
#   CIAM_TENANT_ID=5e4f1080-... CIAM_CLIENT_ID=f0c4b48e-... ./grant-ciam-policy-admin-consent.sh

set -euo pipefail

CIAM_TENANT_ID="${CIAM_TENANT_ID:?CIAM_TENANT_ID is required}"
CIAM_CLIENT_ID="${CIAM_CLIENT_ID:?CIAM_CLIENT_ID is required}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

MSGRAPH_APP_ID="00000003-0000-0000-c000-000000000000"
PERMISSION_VALUE="Policy.ReadWrite.AuthenticationMethod"

echo "=== Admin Consent: Grant CIAM SP $PERMISSION_VALUE ==="
echo "  Tenant:    $CIAM_TENANT_ID"
echo "  Client ID: $CIAM_CLIENT_ID"
echo ""

# ── 1. Verify the admin is logged in to the correct tenant ─────────────────
echo "Verifying Azure CLI session..."
CURRENT_TENANT=$(az account show --query tenantId -o tsv 2>/dev/null || echo "")
if [ -z "$CURRENT_TENANT" ]; then
  echo -e "${RED}Not logged in to Azure CLI.${NC}"
  echo "Run: az login --tenant $CIAM_TENANT_ID"
  exit 1
fi

if [ "$CURRENT_TENANT" != "$CIAM_TENANT_ID" ]; then
  echo -e "${YELLOW}Warning: Current tenant is $CURRENT_TENANT, expected $CIAM_TENANT_ID${NC}"
  echo "Switching to CIAM tenant..."
  az account set --subscription "$CIAM_TENANT_ID" 2>/dev/null || true
fi
echo -e "${GREEN}Azure CLI session verified.${NC}"

# ── 2. Resolve the CIAM service principal object ID ────────────────────────
echo ""
echo "Resolving service principal for $CIAM_CLIENT_ID..."
CIAM_SP_OBJECT_ID=$(az ad sp show --id "$CIAM_CLIENT_ID" --query id -o tsv 2>/dev/null || echo "")

if [ -z "$CIAM_SP_OBJECT_ID" ]; then
  echo -e "${RED}Service principal not found for appId $CIAM_CLIENT_ID${NC}"
  echo "Ensure the app registration exists in the CIAM tenant."
  exit 1
fi
echo -e "${GREEN}SP Object ID: $CIAM_SP_OBJECT_ID${NC}"

# ── 3. Resolve the Microsoft Graph SP and the target app role ──────────────
echo ""
echo "Resolving Microsoft Graph service principal..."
GRAPH_SP_OBJECT_ID=$(az ad sp show --id "$MSGRAPH_APP_ID" --query id -o tsv 2>/dev/null || echo "")

if [ -z "$GRAPH_SP_OBJECT_ID" ]; then
  echo -e "${RED}Microsoft Graph SP not found in the CIAM tenant.${NC}"
  echo "Provision it with: az ad sp create --id $MSGRAPH_APP_ID"
  exit 1
fi
echo -e "${GREEN}Graph SP Object ID: $GRAPH_SP_OBJECT_ID${NC}"

echo ""
echo "Resolving app role ID for $PERMISSION_VALUE..."
ROLE_ID=$(az ad sp show --id "$MSGRAPH_APP_ID" --query "appRoles[?value=='$PERMISSION_VALUE'].id | [0]" -o tsv 2>/dev/null || echo "")

if [ -z "$ROLE_ID" ] || [ "$ROLE_ID" = "None" ]; then
  echo -e "${RED}Could not resolve app role for $PERMISSION_VALUE.${NC}"
  echo "The Microsoft Graph SP may not expose this role in the CIAM tenant."
  exit 1
fi
echo -e "${GREEN}Role ID: $ROLE_ID${NC}"

# ── 4. Check if already granted ───────────────────────────────────────────
echo ""
echo "Checking existing app role assignments..."
EXISTING=$(az rest --method GET \
  --url "https://graph.microsoft.com/v1.0/servicePrincipals/$CIAM_SP_OBJECT_ID/appRoleAssignments" \
  --query "value[?appRoleId=='$ROLE_ID'] | length(@)" \
  -o tsv 2>/dev/null || echo "0")

if [ "$EXISTING" != "0" ]; then
  echo -e "${GREEN}$PERMISSION_VALUE is already granted to the CIAM SP.${NC}"
  echo "No action needed."
  exit 0
fi

# ── 5. Grant the app role assignment as tenant admin ──────────────────────
echo -e "${YELLOW}Granting $PERMISSION_VALUE to CIAM SP...${NC}"
echo ""

GRANT_RESULT=$(az rest --method POST \
  --url "https://graph.microsoft.com/v1.0/servicePrincipals/$CIAM_SP_OBJECT_ID/appRoleAssignments" \
  --body "{
    \"principalId\": \"$CIAM_SP_OBJECT_ID\",
    \"resourceId\": \"$GRAPH_SP_OBJECT_ID\",
    \"appRoleId\": \"$ROLE_ID\"
  }" 2>&1)

GRANT_EXIT=$?

if [ $GRANT_EXIT -eq 0 ]; then
  echo -e "${GREEN}Successfully granted $PERMISSION_VALUE.${NC}"
  echo ""
  echo "$GRANT_RESULT" | python3 -m json.tool 2>/dev/null || echo "$GRANT_RESULT"
  echo ""
  echo "=== Next Steps ==="
  echo "1. Verify with: ./verify-ciam-policy-grant.sh"
  echo "2. Run the SSPR enablement: ./grant-ciam-graph-policy-write.sh (or the SSPR script)"
else
  echo -e "${RED}Failed to grant permission.${NC}"
  echo "$GRANT_RESULT"
  echo ""
  echo "=== Fallback: Azure Portal ==="
  echo "1. Go to https://portal.azure.com → switch to CIAM tenant ($CIAM_TENANT_ID)"
  echo "2. Azure Active Directory → Enterprise applications"
  echo "3. Find the app: $CIAM_CLIENT_ID"
  echo "4. Permissions → Grant admin consent for the tenant"
  echo ""
  echo "Or add the permission manually:"
  echo "1. App registrations → $CIAM_CLIENT_ID → API permissions"
  echo "2. + Add a permission → Microsoft Graph → Application permissions"
  echo "3. Search: Policy.ReadWrite.AuthenticationMethod → Add"
  echo "4. Grant admin consent"
  exit 1
fi
