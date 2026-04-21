#!/usr/bin/env bash
# provision-ciam.sh — Provisions the Entra External ID app registration
# and outputs the env vars needed by AutoFlow backend + frontend.
#
# This script handles everything AFTER the CIAM tenant is created:
#   1. Creates the SPA app registration in the CIAM tenant
#   2. Configures redirect URIs, required permissions, and token settings
#   3. Outputs the env vars for backend (.env) and frontend (.env.local)
#
# IMPORTANT: CIAM tenant creation requires a human admin in Azure Portal:
#   Azure Portal → Microsoft Entra ID → Manage tenants → + Create →
#   Select "Customer" → Fill in: autoflowciam, United States
#
# After the tenant is created, set these env vars and run this script:
#   CIAM_TENANT_ID       — Tenant ID of the new CIAM directory
#   CIAM_TENANT_SUBDOMAIN — Subdomain (e.g. "autoflowciam")
#   CIAM_CLIENT_ID       — SP client ID with Graph access IN the CIAM tenant
#   CIAM_CLIENT_SECRET   — SP client secret for the CIAM tenant
#
# Or, if using the same SP with multi-tenant access:
#   AZURE_CLIENT_ID, AZURE_CLIENT_SECRET with the CIAM tenant ID
#
# Usage: ./provision-ciam.sh

set -euo pipefail

CIAM_TENANT_ID="${CIAM_TENANT_ID:-}"
CIAM_TENANT_SUBDOMAIN="${CIAM_TENANT_SUBDOMAIN:-autoflowciam}"
CIAM_CLIENT_ID="${CIAM_CLIENT_ID:-$AZURE_CLIENT_ID}"
CIAM_CLIENT_SECRET="${CIAM_CLIENT_SECRET:-$AZURE_CLIENT_SECRET}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ -z "$CIAM_TENANT_ID" ]; then
  echo -e "${RED}Error:${NC} CIAM_TENANT_ID is required."
  echo ""
  echo "If you haven't created the CIAM tenant yet, do so in Azure Portal:"
  echo "  1. Go to: https://portal.azure.com/#view/Microsoft_AAD_IAM/TenantManagementMenuBlade/~/createTenant"
  echo "  2. Select: Customer"
  echo "  3. Tenant name: AutoFlow CIAM"
  echo "  4. Domain: autoflowciam"
  echo "  5. Location: United States"
  echo "  6. After creation, copy the Tenant ID from the Overview page"
  echo ""
  echo "Then run: CIAM_TENANT_ID=<guid> ./provision-ciam.sh"
  exit 1
fi

echo "=== AutoFlow CIAM App Registration ==="
echo "  Tenant: $CIAM_TENANT_SUBDOMAIN ($CIAM_TENANT_ID)"
echo ""

# Get Graph token for the CIAM tenant
echo "Authenticating to CIAM tenant..."
GRAPH_RESPONSE=$(curl -s -X POST "https://login.microsoftonline.com/$CIAM_TENANT_ID/oauth2/v2.0/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=$CIAM_CLIENT_ID" \
  -d "client_secret=$CIAM_CLIENT_SECRET" \
  -d "scope=https://graph.microsoft.com/.default" \
  -d "grant_type=client_credentials" 2>/dev/null)

GRAPH_TOKEN=$(echo "$GRAPH_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null || echo "")

if [ -z "$GRAPH_TOKEN" ]; then
  echo -e "${RED}Failed to authenticate to CIAM tenant.${NC}"
  echo "Ensure the SP ($CIAM_CLIENT_ID) is registered in the CIAM tenant"
  echo "or use credentials for an SP that exists in that tenant."
  GRAPH_ERROR=$(echo "$GRAPH_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error_description','')[:200])" 2>/dev/null || echo "")
  echo "Error: $GRAPH_ERROR"
  exit 1
fi

echo -e "${GREEN}Authenticated.${NC}"
echo ""

# Create the SPA app registration
echo "Creating app registration: autoflow-dashboard..."
APP_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $GRAPH_TOKEN" \
  -H "Content-Type: application/json" \
  "https://graph.microsoft.com/v1.0/applications" \
  -d '{
    "displayName": "autoflow-dashboard",
    "signInAudience": "AzureADandPersonalMicrosoftAccount",
    "spa": {
      "redirectUris": [
        "http://localhost:5173/auth/callback",
        "https://staging.app.helloautoflow.com/auth/callback"
      ]
    },
    "requiredResourceAccess": [
      {
        "resourceAppId": "00000003-0000-0000-c000-000000000000",
        "resourceAccess": [
          { "id": "e1fe6dd8-ba31-4d61-89e7-88639da4683d", "type": "Scope" },
          { "id": "37f7f235-527c-4136-accd-4a02d197296e", "type": "Scope" },
          { "id": "64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0", "type": "Scope" },
          { "id": "14dad69e-099b-42c9-810b-d002981feec1", "type": "Scope" }
        ]
      }
    ],
    "web": {
      "implicitGrantSettings": {
        "enableAccessTokenIssuance": false,
        "enableIdTokenIssuance": true
      }
    },
    "api": {
      "requestedAccessTokenVersion": 2
    }
  }' 2>/dev/null)

HTTP_STATUS=$(echo "$APP_RESPONSE" | tail -1)
APP_BODY=$(echo "$APP_RESPONSE" | sed '$d')

if [ "$HTTP_STATUS" != "201" ]; then
  echo -e "${RED}Failed to create app registration (HTTP $HTTP_STATUS).${NC}"
  echo "$APP_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',{}).get('message','Unknown error')[:500])" 2>/dev/null || echo "$APP_BODY"
  exit 1
fi

SPA_CLIENT_ID=$(echo "$APP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['appId'])")
SPA_OBJECT_ID=$(echo "$APP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

echo -e "${GREEN}Created!${NC}"
echo "  Client ID:  $SPA_CLIENT_ID"
echo "  Object ID:  $SPA_OBJECT_ID"
echo ""

# Output the env vars
echo "=== Environment Variables ==="
echo ""
echo "--- Backend (.env) ---"
echo "AZURE_CLIENT_ID=$SPA_CLIENT_ID"
echo "AZURE_TENANT_ID=$CIAM_TENANT_ID"
echo "AZURE_TENANT_SUBDOMAIN=$CIAM_TENANT_SUBDOMAIN"
echo ""
echo "--- Frontend (dashboard/.env.local) ---"
echo "VITE_AZURE_CLIENT_ID=$SPA_CLIENT_ID"
echo "VITE_AZURE_TENANT_SUBDOMAIN=$CIAM_TENANT_SUBDOMAIN"
echo ""
echo "--- Vercel Environment Variables ---"
echo "VITE_AZURE_CLIENT_ID=$SPA_CLIENT_ID"
echo "VITE_AZURE_TENANT_SUBDOMAIN=$CIAM_TENANT_SUBDOMAIN"
echo ""
echo "=== Next Steps ==="
echo "1. Set the env vars above in your .env and .env.local files"
echo "2. Verify the SPA redirect URIs include the local and staging callback routes:"
echo "   - http://localhost:5173/auth/callback"
echo "   - https://staging.app.helloautoflow.com/auth/callback"
echo "   https://portal.azure.com → Entra ID (tenant: $CIAM_TENANT_SUBDOMAIN) →"
echo "   App registrations → autoflow-dashboard → Authentication → Add URI"
echo "3. Configure a sign-up/sign-in user flow in the CIAM tenant:"
echo "   External Identities → User flows → + New user flow → Sign up and sign in"
echo "4. (Optional) Add Google/Apple identity providers under External Identities → All identity providers"
