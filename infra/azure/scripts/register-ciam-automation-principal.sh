#!/usr/bin/env bash
# register-ciam-automation-principal.sh — Registers an automation service
# principal in the AutoFlow CIAM tenant with the Graph permissions needed for
# branding and custom auth-domain automation.
#
# This script must be run by an administrator who has Global Administrator
# or Application Administrator role in the CIAM tenant.
#
# Required env vars:
#   CIAM_TENANT_ID        — Tenant ID of the CIAM directory (5e4f1080-...)
#   ADMIN_ACCESS_TOKEN     — A Graph API access token from an admin session in
#                            the CIAM tenant. Obtain via:
#                            az login --tenant $CIAM_TENANT_ID
#                            az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv
#
# Optional env vars:
#   AUTOMATION_APP_NAME    — Display name for the automation app (default: autoflow-automation)
#   SECRET_VALIDITY_YEARS  — Client secret validity in years (default: 1)
#
# What this script does:
#   1. Creates an app registration in the CIAM tenant for automation
#   2. Grants the required Graph API application permissions
#   3. Creates a service principal for the app
#   4. Triggers admin consent for the permissions
#   5. Creates a client secret
#   6. Outputs the credentials for env/secret configuration
#
# Usage:
#   CIAM_TENANT_ID=5e4f1080-8afc-4005-b05e-32b21e69363a \
#   ADMIN_ACCESS_TOKEN=$(az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv) \
#   ./register-ciam-automation-principal.sh

set -euo pipefail

CIAM_TENANT_ID="${CIAM_TENANT_ID:-}"
ADMIN_ACCESS_TOKEN="${ADMIN_ACCESS_TOKEN:-}"
AUTOMATION_APP_NAME="${AUTOMATION_APP_NAME:-autoflow-automation}"
SECRET_VALIDITY_YEARS="${SECRET_VALIDITY_YEARS:-1}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

if [ -z "$CIAM_TENANT_ID" ]; then
  fail "CIAM_TENANT_ID is required."
  echo "  Set CIAM_TENANT_ID=5e4f1080-8afc-4005-b05e-32b21e69363a"
  exit 1
fi

if [ -z "$ADMIN_ACCESS_TOKEN" ]; then
  fail "ADMIN_ACCESS_TOKEN is required."
  echo ""
  echo "  Obtain one by running:"
  echo "    az login --tenant $CIAM_TENANT_ID"
  echo "    export ADMIN_ACCESS_TOKEN=\$(az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv)"
  echo ""
  echo "  The logged-in user must have Global Administrator or Application Administrator"
  echo "  role in the CIAM tenant."
  exit 1
fi

echo "=== Register Automation Principal in CIAM Tenant ==="
echo "  Tenant:   $CIAM_TENANT_ID"
echo "  App name: $AUTOMATION_APP_NAME"
echo ""

# Verify the token works
info "Verifying admin token..."
VERIFY=$(curl -s -w "\n%{http_code}" -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/organization" 2>/dev/null)

VERIFY_STATUS=$(echo "$VERIFY" | tail -1)
if [ "$VERIFY_STATUS" != "200" ]; then
  fail "Admin token is invalid or expired (HTTP $VERIFY_STATUS)."
  echo "  Re-authenticate with: az login --tenant $CIAM_TENANT_ID"
  exit 1
fi
pass "Admin token valid"

# Check if app already exists
info "Checking for existing app registration..."
EXISTING=$(curl -s -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/applications?\$filter=displayName%20eq%20'$AUTOMATION_APP_NAME'&\$select=id,appId,displayName" 2>/dev/null)

EXISTING_APP_ID=$(echo "$EXISTING" | python3 -c "import sys,json; v=json.load(sys.stdin).get('value',[]); print(v[0]['appId'] if v else '')" 2>/dev/null || echo "")
EXISTING_OBJ_ID=$(echo "$EXISTING" | python3 -c "import sys,json; v=json.load(sys.stdin).get('value',[]); print(v[0]['id'] if v else '')" 2>/dev/null || echo "")

# Graph API permission IDs (application permissions):
#   Application.ReadWrite.All    — 1bfefb4e-e0b5-418b-a88f-73c46d2cc8e9
#   Organization.ReadWrite.All   — 292d869f-3427-49a8-9dab-8c70152b74e9
#   Domain.ReadWrite.All         — 7e05723c-0bb0-42da-be13-92dccda2db2c
GRAPH_SP_ID="00000003-0000-0000-c000-000000000000"

APP_BODY=$(cat <<'JSON'
{
  "displayName": "APPNAME_PLACEHOLDER",
  "signInAudience": "AzureADMyOrg",
  "requiredResourceAccess": [
    {
      "resourceAppId": "00000003-0000-0000-c000-000000000000",
      "resourceAccess": [
        { "id": "1bfefb4e-e0b5-418b-a88f-73c46d2cc8e9", "type": "Role" },
        { "id": "292d869f-3427-49a8-9dab-8c70152b74e9", "type": "Role" },
        { "id": "7e05723c-0bb0-42da-be13-92dccda2db2c", "type": "Role" }
      ]
    }
  ]
}
JSON
)

APP_BODY="${APP_BODY//APPNAME_PLACEHOLDER/$AUTOMATION_APP_NAME}"

if [ -n "$EXISTING_APP_ID" ]; then
  info "App '$AUTOMATION_APP_NAME' already exists (appId: $EXISTING_APP_ID)"
  info "Updating permissions on existing registration..."

  PATCH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH \
    -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    "https://graph.microsoft.com/v1.0/applications/$EXISTING_OBJ_ID" \
    -d "$APP_BODY" 2>/dev/null)

  if [ "$PATCH_STATUS" != "204" ]; then
    fail "Failed to update app registration (HTTP $PATCH_STATUS)"
    exit 1
  fi
  pass "Updated app registration permissions"

  APP_CLIENT_ID="$EXISTING_APP_ID"
  APP_OBJECT_ID="$EXISTING_OBJ_ID"
else
  info "Creating app registration..."
  CREATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    "https://graph.microsoft.com/v1.0/applications" \
    -d "$APP_BODY" 2>/dev/null)

  CREATE_STATUS=$(echo "$CREATE_RESPONSE" | tail -1)
  CREATE_BODY=$(echo "$CREATE_RESPONSE" | sed '$d')

  if [ "$CREATE_STATUS" != "201" ]; then
    fail "Failed to create app registration (HTTP $CREATE_STATUS)"
    echo "$CREATE_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',{}).get('message','Unknown')[:500])" 2>/dev/null || echo "$CREATE_BODY"
    exit 1
  fi

  APP_CLIENT_ID=$(echo "$CREATE_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['appId'])")
  APP_OBJECT_ID=$(echo "$CREATE_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

  pass "Created app registration"
  echo "  Client ID:  $APP_CLIENT_ID"
  echo "  Object ID:  $APP_OBJECT_ID"
fi

echo ""

# Create service principal if it doesn't exist
info "Ensuring service principal exists..."
SP_CHECK=$(curl -s -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/servicePrincipals?\$filter=appId%20eq%20'$APP_CLIENT_ID'&\$select=id" 2>/dev/null)

SP_ID=$(echo "$SP_CHECK" | python3 -c "import sys,json; v=json.load(sys.stdin).get('value',[]); print(v[0]['id'] if v else '')" 2>/dev/null || echo "")

if [ -z "$SP_ID" ]; then
  SP_CREATE=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    "https://graph.microsoft.com/v1.0/servicePrincipals" \
    -d "{\"appId\": \"$APP_CLIENT_ID\"}" 2>/dev/null)

  SP_STATUS=$(echo "$SP_CREATE" | tail -1)
  SP_BODY=$(echo "$SP_CREATE" | sed '$d')

  if [ "$SP_STATUS" != "201" ]; then
    fail "Failed to create service principal (HTTP $SP_STATUS)"
    exit 1
  fi

  SP_ID=$(echo "$SP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
  pass "Created service principal ($SP_ID)"
else
  pass "Service principal exists ($SP_ID)"
fi

echo ""

# Grant admin consent for the application permissions
info "Granting admin consent for Graph API permissions..."

# Get the Microsoft Graph service principal in the CIAM tenant
GRAPH_SP_CHECK=$(curl -s -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/servicePrincipals?\$filter=appId%20eq%20'$GRAPH_SP_ID'&\$select=id" 2>/dev/null)

GRAPH_SP_OBJ_ID=$(echo "$GRAPH_SP_CHECK" | python3 -c "import sys,json; v=json.load(sys.stdin).get('value',[]); print(v[0]['id'] if v else '')" 2>/dev/null || echo "")

if [ -z "$GRAPH_SP_OBJ_ID" ]; then
  fail "Cannot find Microsoft Graph service principal in CIAM tenant"
  echo "  This is unexpected — Graph SP should exist in every Entra tenant."
  exit 1
fi

# Grant each permission via appRoleAssignment
PERMISSIONS=(
  "1bfefb4e-e0b5-418b-a88f-73c46d2cc8e9:Application.ReadWrite.All"
  "292d869f-3427-49a8-9dab-8c70152b74e9:Organization.ReadWrite.All"
  "7e05723c-0bb0-42da-be13-92dccda2db2c:Domain.ReadWrite.All"
)

for perm_entry in "${PERMISSIONS[@]}"; do
  PERM_ID="${perm_entry%%:*}"
  PERM_NAME="${perm_entry##*:}"

  CONSENT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    "https://graph.microsoft.com/v1.0/servicePrincipals/$SP_ID/appRoleAssignments" \
    -d "{
      \"principalId\": \"$SP_ID\",
      \"resourceId\": \"$GRAPH_SP_OBJ_ID\",
      \"appRoleId\": \"$PERM_ID\"
    }" 2>/dev/null)

  CONSENT_STATUS=$(echo "$CONSENT_RESPONSE" | tail -1)

  if [ "$CONSENT_STATUS" = "201" ]; then
    pass "Granted $PERM_NAME"
  elif [ "$CONSENT_STATUS" = "409" ]; then
    pass "$PERM_NAME already granted"
  else
    fail "Failed to grant $PERM_NAME (HTTP $CONSENT_STATUS)"
    CONSENT_BODY=$(echo "$CONSENT_RESPONSE" | sed '$d')
    echo "  $(echo "$CONSENT_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',{}).get('message','')[:200])" 2>/dev/null || echo "$CONSENT_BODY")"
  fi
done

echo ""

# Create a client secret
info "Creating client secret (valid $SECRET_VALIDITY_YEARS year(s))..."
END_DATE=$(python3 -c "from datetime import datetime,timedelta; print((datetime.utcnow()+timedelta(days=365*$SECRET_VALIDITY_YEARS)).strftime('%Y-%m-%dT%H:%M:%SZ'))")

SECRET_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "https://graph.microsoft.com/v1.0/applications/$APP_OBJECT_ID/addPassword" \
  -d "{
    \"passwordCredential\": {
      \"displayName\": \"autoflow-automation-secret\",
      \"endDateTime\": \"$END_DATE\"
    }
  }" 2>/dev/null)

SECRET_STATUS=$(echo "$SECRET_RESPONSE" | tail -1)
SECRET_BODY=$(echo "$SECRET_RESPONSE" | sed '$d')

if [ "$SECRET_STATUS" != "200" ]; then
  fail "Failed to create client secret (HTTP $SECRET_STATUS)"
  echo "  You may need to create the secret manually in Azure Portal."
  echo ""
  echo "=== Partial Output ==="
  echo "  CIAM_CLIENT_ID=$APP_CLIENT_ID"
  echo "  CIAM_TENANT_ID=$CIAM_TENANT_ID"
  echo "  # Create the secret manually and set CIAM_CLIENT_SECRET"
  exit 1
fi

CLIENT_SECRET=$(echo "$SECRET_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['secretText'])")
SECRET_ID=$(echo "$SECRET_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['keyId'])")
SECRET_EXPIRY=$(echo "$SECRET_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['endDateTime'])")

pass "Client secret created (keyId: $SECRET_ID, expires: $SECRET_EXPIRY)"

echo ""
echo "=== Credentials Output ==="
echo ""
echo -e "${YELLOW}IMPORTANT: Save these values now. The client secret cannot be retrieved again.${NC}"
echo ""
echo "  CIAM_TENANT_ID=$CIAM_TENANT_ID"
echo "  CIAM_CLIENT_ID=$APP_CLIENT_ID"
echo "  CIAM_CLIENT_SECRET=$CLIENT_SECRET"
echo ""
echo "=== Verification ==="
echo ""
echo "Test the credentials:"
echo "  CIAM_TENANT_ID=$CIAM_TENANT_ID CIAM_CLIENT_ID=$APP_CLIENT_ID CIAM_CLIENT_SECRET=<secret> \\"
echo "    ./validate-ciam-prereqs.sh"
echo ""
echo "=== Next Steps ==="
echo "1. Store CIAM_CLIENT_ID and CIAM_CLIENT_SECRET in your secret manager"
echo "2. Update CI/CD env vars or GitHub Actions secrets"
echo "3. Run validate-ciam-prereqs.sh to confirm CIAM tenant access"
echo "4. Unblock ALT-1648 (Entra branding + custom auth domain)"
