locals {
  prefix = "${var.app_name}-${var.environment}"
  tags = {
    environment  = var.environment
    project      = "autoflow"
    managed-by   = "terraform"
  }
}

# ─── Resource Group ───────────────────────────────────────────────────────────

resource "azurerm_resource_group" "main" {
  name     = "rg-${local.prefix}"
  location = var.location
  tags     = local.tags
}

# ─── Networking ───────────────────────────────────────────────────────────────

resource "azurerm_virtual_network" "main" {
  name                = "vnet-${local.prefix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  address_space       = [var.vnet_address_space]
  tags                = local.tags
}

# Subnet delegated to Azure Container Apps (minimum /21)
resource "azurerm_subnet" "container_apps" {
  name                 = "snet-container-apps"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [var.container_apps_subnet_cidr]

  delegation {
    name = "delegation"
    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

# Subnet for private endpoints (PostgreSQL, Redis)
resource "azurerm_subnet" "private_endpoints" {
  name                                      = "snet-private-endpoints"
  resource_group_name                       = azurerm_resource_group.main.name
  virtual_network_name                      = azurerm_virtual_network.main.name
  address_prefixes                          = [var.private_endpoints_subnet_cidr]
  private_endpoint_network_policies_enabled = false
}

# ─── Log Analytics (required by Container Apps environment) ───────────────────

resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-${local.prefix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

# ─── User-Assigned Managed Identity (used by Container Apps) ─────────────────

resource "azurerm_user_assigned_identity" "app" {
  name                = "id-${local.prefix}-app"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  tags                = local.tags
}

# ─── OIDC federation for GitHub Actions ──────────────────────────────────────
# Allows GitHub Actions to authenticate to Azure without stored credentials.
# The federated identity covers both push-to-main (staging) and tag releases (production).

data "azuread_client_config" "current" {}

resource "azuread_application" "github_actions" {
  display_name = "sp-${local.prefix}-github-actions"
  owners       = [data.azuread_client_config.current.object_id]
}

resource "azuread_service_principal" "github_actions" {
  client_id = azuread_application.github_actions.client_id
  owners    = [data.azuread_client_config.current.object_id]
}

# Federated credential for pushes to main (staging deployments)
resource "azuread_application_federated_identity_credential" "main_branch" {
  application_id = azuread_application.github_actions.id
  display_name   = "github-${replace(var.github_repo, "/", "-")}-main"
  description    = "GitHub Actions on main branch"
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = "https://token.actions.githubusercontent.com"
  subject        = "repo:${var.github_repo}:ref:refs/heads/main"
}

# Federated credential for tagged releases (production deployments)
resource "azuread_application_federated_identity_credential" "tags" {
  application_id = azuread_application.github_actions.id
  display_name   = "github-${replace(var.github_repo, "/", "-")}-tags"
  description    = "GitHub Actions on version tags"
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = "https://token.actions.githubusercontent.com"
  subject        = "repo:${var.github_repo}:ref:refs/tags/*"
}

data "azurerm_subscription" "current" {}

# Grant Contributor on the resource group so GitHub Actions can run Terraform
resource "azurerm_role_assignment" "github_actions_contributor" {
  scope                = azurerm_resource_group.main.id
  role_definition_name = "Contributor"
  principal_id         = azuread_service_principal.github_actions.object_id
}
