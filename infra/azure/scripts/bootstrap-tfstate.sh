#!/usr/bin/env bash
# bootstrap-tfstate.sh — one-time setup for Terraform remote state storage.
# Run this once per subscription before the first `terraform init`.
#
# Usage:
#   AZURE_SUBSCRIPTION_ID=<sub-id> ./infra/azure/scripts/bootstrap-tfstate.sh
#
# Requires: az CLI, jq

set -euo pipefail

SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:?Set AZURE_SUBSCRIPTION_ID}"
LOCATION="${LOCATION:-eastus2}"
RG_NAME="autoflow-tfstate-rg"
SA_NAME="autoflowterraformstate"
CONTAINER_NAME="tfstate"

echo "==> Setting subscription: $SUBSCRIPTION_ID"
az account set --subscription "$SUBSCRIPTION_ID"

echo "==> Creating resource group: $RG_NAME"
az group create \
  --name "$RG_NAME" \
  --location "$LOCATION" \
  --output none

echo "==> Creating storage account: $SA_NAME"
az storage account create \
  --name "$SA_NAME" \
  --resource-group "$RG_NAME" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --kind StorageV2 \
  --allow-blob-public-access false \
  --min-tls-version TLS1_2 \
  --output none

echo "==> Enabling versioning on storage account"
az storage account blob-service-properties update \
  --account-name "$SA_NAME" \
  --resource-group "$RG_NAME" \
  --enable-versioning true \
  --output none

echo "==> Creating blob container: $CONTAINER_NAME"
az storage container create \
  --name "$CONTAINER_NAME" \
  --account-name "$SA_NAME" \
  --auth-mode login \
  --output none

echo ""
echo "✓ Terraform remote state backend ready."
echo "  Resource group : $RG_NAME"
echo "  Storage account: $SA_NAME"
echo "  Container      : $CONTAINER_NAME"
echo ""
echo "Next steps:"
echo "  cd infra/azure && terraform init"
