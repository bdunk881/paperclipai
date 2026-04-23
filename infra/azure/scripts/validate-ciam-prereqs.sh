#!/usr/bin/env bash
# validate-ciam-prereqs.sh — Validates that Azure credentials have sufficient
# permissions to provision an Entra External ID (CIAM) tenant and register an app.
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
fi

echo ""

# 5. Acquire Graph token
echo "--- Microsoft Graph API access ---"
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

# 8. CIAM tenant-local access check
echo "--- CIAM tenant-local access ---"
CIAM_TENANT_ID="${CIAM_TENANT_ID:-}"

if [ -z "$CIAM_TENANT_ID" ]; then
  warn "CIAM_TENANT_ID not set — skipping CIAM tenant-local checks"
  echo "  Set CIAM_TENANT_ID=5e4f1080-8afc-4005-b05e-32b21e69363a to enable"
else
  CIAM_CLIENT_ID="${CIAM_CLIENT_ID:-$AZURE_CLIENT_ID}"
  CIAM_CLIENT_SECRET="${CIAM_CLIENT_SECRET:-$AZURE_CLIENT_SECRET}"

  CIAM_GRAPH_RESPONSE=$(curl -s -X POST "https://login.microsoftonline.com/$CIAM_TENANT_ID/oauth2/v2.0/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "client_id=$CIAM_CLIENT_ID" \
    -d "client_secret=$CIAM_CLIENT_SECRET" \
    -d "scope=https://graph.microsoft.com/.default" \
    -d "grant_type=client_credentials" 2>/dev/null)

  CIAM_GRAPH_TOKEN=$(echo "$CIAM_GRAPH_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null || echo "")

  if [ -z "$CIAM_GRAPH_TOKEN" ]; then
    fail "Could not acquire Graph token for CIAM tenant ($CIAM_TENANT_ID)"
    CIAM_ERROR=$(echo "$CIAM_GRAPH_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error_description','unknown')[:300])" 2>/dev/null || echo "unknown")
    echo "  Error: $CIAM_ERROR"
    echo ""
    echo "  Fix: register an automation principal in the CIAM tenant."
    echo "  Run: infra/azure/scripts/register-ciam-automation-principal.sh"
    errors=$((errors + 1))
  else
    pass "Graph token acquired for CIAM tenant ($CIAM_TENANT_ID)"

    # Verify we can list apps in the CIAM tenant
    CIAM_APP_RESPONSE=$(curl -s -H "Authorization: Bearer $CIAM_GRAPH_TOKEN" \
      "https://graph.microsoft.com/v1.0/applications?\$top=1" 2>/dev/null)

    CIAM_APP_ERROR=$(echo "$CIAM_APP_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',{}).get('code',''))" 2>/dev/null || echo "")

    if [ -z "$CIAM_APP_ERROR" ]; then
      pass "Can list app registrations in CIAM tenant"
    else
      fail "Cannot list app registrations in CIAM tenant (error: $CIAM_APP_ERROR)"
      echo "  The automation principal needs Application.ReadWrite.All in the CIAM tenant."
      errors=$((errors + 1))
    fi

    # Check Organization.ReadWrite.All (needed for branding)
    CIAM_ORG_RESPONSE=$(curl -s -H "Authorization: Bearer $CIAM_GRAPH_TOKEN" \
      "https://graph.microsoft.com/v1.0/organization" 2>/dev/null)

    CIAM_ORG_ERROR=$(echo "$CIAM_ORG_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',{}).get('code',''))" 2>/dev/null || echo "")

    if [ -z "$CIAM_ORG_ERROR" ]; then
      pass "Can read organization in CIAM tenant (needed for branding)"
    else
      warn "Cannot read organization in CIAM tenant (error: $CIAM_ORG_ERROR)"
      echo "  Organization.ReadWrite.All is needed for custom branding in ALT-1648."
    fi
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
  echo ""
  echo "For CIAM tenant-local access:"
  echo "  4. An app registration in the CIAM tenant with Application.ReadWrite.All"
  echo "  5. Organization.ReadWrite.All for branding operations"
  echo "  Run: infra/azure/scripts/register-ciam-automation-principal.sh"
fi

exit $errors
