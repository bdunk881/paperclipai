#!/usr/bin/env bash
# validate-ciam-prereqs.sh — Validates that Azure credentials have sufficient
# permissions to provision an Entra External ID (CIAM) tenant and to operate
# inside that tenant for app registration, branding, and custom-domain follow-up.
#
# Required env vars: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_SUBSCRIPTION_ID
#
# Usage: ./validate-ciam-prereqs.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

errors=0
ciam_tenant_id=""
ciam_domain_name=""

echo "=== Entra External ID (CIAM) Prerequisites Check ==="
echo ""

# 1. Check required env vars
for var in AZURE_TENANT_ID AZURE_CLIENT_ID AZURE_CLIENT_SECRET AZURE_SUBSCRIPTION_ID; do
  if [ -z "${!var:-}" ]; then
    fail "$var is not set"
    errors=$((errors + 1))
  else
    pass "$var is set"
  fi
done

echo ""

# 2. Acquire ARM token
echo "--- Azure Resource Manager access ---"
ARM_RESPONSE=$(curl -s -X POST "https://login.microsoftonline.com/$AZURE_TENANT_ID/oauth2/v2.0/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=$AZURE_CLIENT_ID" \
  -d "client_secret=$AZURE_CLIENT_SECRET" \
  -d "scope=https://management.azure.com/.default" \
  -d "grant_type=client_credentials" 2>/dev/null)

ARM_TOKEN=$(echo "$ARM_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null || echo "")

if [ -z "$ARM_TOKEN" ]; then
  fail "Could not acquire ARM token"
  ARM_ERROR=$(echo "$ARM_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error_description','unknown'))" 2>/dev/null || echo "unknown")
  echo "  Error: $ARM_ERROR"
  errors=$((errors + 1))
else
  pass "ARM token acquired"

  # 3. Check subscription access
  SUB_RESPONSE=$(curl -s -H "Authorization: Bearer $ARM_TOKEN" \
    "https://management.azure.com/subscriptions/$AZURE_SUBSCRIPTION_ID?api-version=2022-12-01" 2>/dev/null)

  SUB_STATE=$(echo "$SUB_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('state',''))" 2>/dev/null || echo "")
  SUB_ERROR=$(echo "$SUB_RESPONSE" | python3 -c "import sys,json; e=d=json.load(sys.stdin).get('error',{}); print(e.get('code',''))" 2>/dev/null || echo "")

  if [ -n "$SUB_STATE" ]; then
    pass "Subscription $AZURE_SUBSCRIPTION_ID is accessible (state: $SUB_STATE)"
  else
    fail "Cannot read subscription $AZURE_SUBSCRIPTION_ID (error: $SUB_ERROR)"
    echo "  The SP needs at least Reader role on the subscription."
    echo "  For CIAM provisioning, it needs Contributor or a custom role with:"
    echo "    - Microsoft.AzureActiveDirectory/b2cDirectories/write"
    echo "    - Microsoft.AzureActiveDirectory/b2cDirectories/read"
    errors=$((errors + 1))
  fi

  # 4. Check if AAD B2C/CIAM resource provider is registered
  RP_RESPONSE=$(curl -s -H "Authorization: Bearer $ARM_TOKEN" \
    "https://management.azure.com/subscriptions/$AZURE_SUBSCRIPTION_ID/providers/Microsoft.AzureActiveDirectory?api-version=2021-04-01" 2>/dev/null)

  RP_STATE=$(echo "$RP_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('registrationState',''))" 2>/dev/null || echo "")

  if [ "$RP_STATE" = "Registered" ]; then
    pass "Microsoft.AzureActiveDirectory resource provider is registered"
  elif [ -n "$RP_STATE" ]; then
    warn "Microsoft.AzureActiveDirectory resource provider state: $RP_STATE"
    echo "  Register it with: az provider register --namespace Microsoft.AzureActiveDirectory"
    errors=$((errors + 1))
  else
    warn "Could not check resource provider status (may lack subscription access)"
  fi

  # 5. Detect an existing CIAM directory so tenant-local access can be validated.
  CIAM_RESPONSE=$(curl -s -H "Authorization: Bearer $ARM_TOKEN" \
    "https://management.azure.com/subscriptions/$AZURE_SUBSCRIPTION_ID/providers/Microsoft.AzureActiveDirectory/ciamDirectories?api-version=2023-05-17-preview" 2>/dev/null)

  ciam_tenant_id=$(echo "$CIAM_RESPONSE" | python3 -c "import sys,json; data=json.load(sys.stdin); value=data.get('value', []); print(value[0].get('properties', {}).get('tenantId', '')) if value else print('')" 2>/dev/null || echo "")
  ciam_domain_name=$(echo "$CIAM_RESPONSE" | python3 -c "import sys,json; data=json.load(sys.stdin); value=data.get('value', []); print(value[0].get('properties', {}).get('domainName', '')) if value else print('')" 2>/dev/null || echo "")

  if [ -n "$ciam_tenant_id" ]; then
    pass "Found CIAM directory $ciam_domain_name (tenant: $ciam_tenant_id)"
  else
    warn "No CIAM directory found in subscription $AZURE_SUBSCRIPTION_ID"
    echo "  If the tenant already exists, verify you are using the correct subscription."
  fi
fi

echo ""

# 6. Acquire Graph token in the workforce tenant
echo "--- Microsoft Graph API access (workforce tenant) ---"
GRAPH_RESPONSE=$(curl -s -X POST "https://login.microsoftonline.com/$AZURE_TENANT_ID/oauth2/v2.0/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=$AZURE_CLIENT_ID" \
  -d "client_secret=$AZURE_CLIENT_SECRET" \
  -d "scope=https://graph.microsoft.com/.default" \
  -d "grant_type=client_credentials" 2>/dev/null)

GRAPH_TOKEN=$(echo "$GRAPH_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null || echo "")

if [ -z "$GRAPH_TOKEN" ]; then
  fail "Could not acquire Graph token"
  errors=$((errors + 1))
else
  pass "Graph API token acquired"

  # 6. Check Graph permissions — can we list applications?
  APP_RESPONSE=$(curl -s -H "Authorization: Bearer $GRAPH_TOKEN" \
    "https://graph.microsoft.com/v1.0/applications?\$top=1" 2>/dev/null)

  APP_ERROR=$(echo "$APP_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',{}).get('code',''))" 2>/dev/null || echo "")

  if [ -z "$APP_ERROR" ]; then
    pass "Can list app registrations (Application.Read.All)"
  else
    fail "Cannot list app registrations (error: $APP_ERROR)"
    echo "  The SP needs Application.ReadWrite.All to create the CIAM app registration."
    errors=$((errors + 1))
  fi

  # 7. Check if we can create applications (try-fail is the only way to test write)
  warn "Application.ReadWrite.All write permission cannot be verified without creating a test app"
  echo "  Verify manually: az ad sp show --id $AZURE_CLIENT_ID --query appRoles"
fi

echo ""

# 8. Check whether the automation identity exists in the CIAM tenant.
if [ -n "$ciam_tenant_id" ]; then
  echo "--- CIAM tenant-local access ---"
  CIAM_GRAPH_RESPONSE=$(curl -s -X POST "https://login.microsoftonline.com/$ciam_tenant_id/oauth2/v2.0/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "client_id=$AZURE_CLIENT_ID" \
    -d "client_secret=$AZURE_CLIENT_SECRET" \
    -d "scope=https://graph.microsoft.com/.default" \
    -d "grant_type=client_credentials" 2>/dev/null)

  CIAM_GRAPH_TOKEN=$(echo "$CIAM_GRAPH_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null || echo "")

  if [ -n "$CIAM_GRAPH_TOKEN" ]; then
    pass "Can acquire a Graph token against the CIAM tenant"
  else
    fail "Cannot authenticate into the CIAM tenant with the current automation identity"
    CIAM_GRAPH_ERROR=$(echo "$CIAM_GRAPH_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error_description','unknown'))" 2>/dev/null || echo "unknown")
    echo "  Error: $CIAM_GRAPH_ERROR"
    echo "  Branding, custom-domain association, and CIAM app registration work require"
    echo "  a service principal that exists in the CIAM tenant ($ciam_tenant_id)."
    echo "  Fix: register or consent the automation app in the CIAM tenant, then grant"
    echo "  the needed Graph permissions there before rerunning this script."
    errors=$((errors + 1))
  fi
fi

echo ""
echo "=== Summary ==="
if [ $errors -eq 0 ]; then
  pass "All prerequisites passed. Ready to provision CIAM tenant."
else
  fail "$errors prerequisite(s) failed. See above for details."
  echo ""
  echo "Required SP permissions for CIAM provisioning:"
  echo "  1. Contributor (or custom role) on subscription $AZURE_SUBSCRIPTION_ID"
  echo "  2. Application.ReadWrite.All on Microsoft Graph (application permission)"
  echo "  3. Microsoft.AzureActiveDirectory resource provider registered on the subscription"
  if [ -n "$ciam_tenant_id" ]; then
    echo "  4. The automation app must exist in the CIAM tenant $ciam_tenant_id for branding/custom-domain tasks"
  fi
fi

exit $errors
