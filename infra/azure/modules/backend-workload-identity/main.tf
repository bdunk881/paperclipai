locals {
  identity_name                = "id-${var.prefix}-prod-app"
  federated_credential_name    = "${var.environment}-backend"
  federated_credential_subject = "system:serviceaccount:${var.namespace}:${var.service_account_name}"
}

resource "azurerm_user_assigned_identity" "backend" {
  name                = local.identity_name
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_federated_identity_credential" "backend" {
  name                = local.federated_credential_name
  resource_group_name = var.resource_group_name
  parent_id           = azurerm_user_assigned_identity.backend.id
  audience            = ["api://AzureADTokenExchange"]
  issuer              = var.oidc_issuer_url
  subject             = local.federated_credential_subject
}
