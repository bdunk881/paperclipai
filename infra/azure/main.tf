terraform {
  required_version = ">= 1.6"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.100"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 2.50"
    }
  }

  backend "azurerm" {
    resource_group_name  = "autoflow-tfstate-rg"
    storage_account_name = "autoflowterraformstate"
    container_name       = "tfstate"
  }
}

provider "azurerm" {
  features {
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
    key_vault {
      purge_soft_delete_on_destroy = false
    }
  }
}

provider "azuread" {}

# ── Resource group ──────────────────────────────────────────────────────────

resource "azurerm_resource_group" "main" {
  name     = "${var.prefix}-${var.environment}-rg"
  location = var.location

  tags = local.common_tags
}

# ── Modules ──────────────────────────────────────────────────────────────────

module "hub" {
  source = "./modules/hub"

  prefix              = var.prefix
  environment         = var.environment
  location            = var.location
  resource_group_name = azurerm_resource_group.main.name
  enable_firewall     = var.enable_hub_firewall
  enable_bastion      = var.enable_hub_bastion
  tenant_id           = var.tenant_id
  tags                = local.common_tags
}

# ── Spoke VNets (workspace-scoped) ────────────────────────────────────────────
# Each workspace provisions only its active spoke. This keeps the production
# workspace from planning or mutating staging network resources.

module "spoke_prod" {
  count  = var.environment == "production" ? 1 : 0
  source = "./modules/spoke"

  prefix                  = var.prefix
  environment             = "prod"
  location                = var.location
  resource_group_name     = azurerm_resource_group.main.name
  spoke_vnet_cidr         = "10.2.0.0/16"
  aks_subnet_cidr         = "10.2.1.0/24"
  pe_subnet_cidr          = "10.2.2.0/24"
  svc_subnet_cidr         = "10.2.3.0/24"
  func_subnet_cidr        = "10.2.4.0/24"
  hub_vnet_id             = module.hub.hub_vnet_id
  hub_vnet_name           = module.hub.hub_vnet_name
  hub_resource_group_name = azurerm_resource_group.main.name
  hub_firewall_private_ip = module.hub.firewall_private_ip
  tags                    = local.common_tags
}

module "spoke_staging" {
  count  = var.environment == "staging" ? 1 : 0
  source = "./modules/spoke"

  prefix                  = var.prefix
  environment             = "staging"
  location                = var.location
  resource_group_name     = azurerm_resource_group.main.name
  spoke_vnet_cidr         = "10.3.0.0/16"
  aks_subnet_cidr         = "10.3.1.0/24"
  pe_subnet_cidr          = "10.3.2.0/24"
  svc_subnet_cidr         = "10.3.3.0/24"
  func_subnet_cidr        = "10.3.4.0/24"
  hub_vnet_id             = module.hub.hub_vnet_id
  hub_vnet_name           = module.hub.hub_vnet_name
  hub_resource_group_name = azurerm_resource_group.main.name
  hub_firewall_private_ip = module.hub.firewall_private_ip
  tags                    = local.common_tags
}

# Select the correct spoke subnet IDs based on the active workspace environment.
locals {
  active_aks_subnet_id  = var.environment == "production" ? module.spoke_prod[0].aks_subnet_id : module.spoke_staging[0].aks_subnet_id
  active_pe_subnet_id   = var.environment == "production" ? module.spoke_prod[0].pe_subnet_id : module.spoke_staging[0].pe_subnet_id
  active_func_subnet_id = var.environment == "production" ? module.spoke_prod[0].func_subnet_id : module.spoke_staging[0].func_subnet_id
  active_vnet_id        = var.environment == "production" ? module.spoke_prod[0].spoke_vnet_id : module.spoke_staging[0].spoke_vnet_id
  # GitHub-hosted runner IPs are too large and too dynamic to fit AKS API
  # allowlists in production. Keep staging locked to the hub management subnet,
  # but leave production unrestricted until deploys move to stable egress.
  effective_api_server_authorized_ips = var.environment == "production" ? [] : var.api_server_authorized_ips
}

module "acr" {
  source = "./modules/acr"

  prefix              = var.prefix
  environment         = var.environment
  location            = var.location
  resource_group_name = azurerm_resource_group.main.name
  pe_subnet_id        = local.active_pe_subnet_id
  private_dns_zone_id = module.hub.private_dns_zone_acr_id
  vnet_id             = local.active_vnet_id
  tags                = local.common_tags
}

module "aks" {
  source = "./modules/aks"

  prefix                    = var.prefix
  environment               = var.environment
  location                  = var.location
  resource_group_name       = azurerm_resource_group.main.name
  aks_subnet_id             = local.active_aks_subnet_id
  acr_id                    = module.acr.acr_id
  node_count                = var.node_count
  node_vm_size              = var.node_vm_size
  min_node_count            = var.min_node_count
  max_node_count            = var.max_node_count
  kubernetes_version        = var.kubernetes_version
  api_server_authorized_ips = local.effective_api_server_authorized_ips
  tags                      = local.common_tags
}

module "management" {
  source = "./modules/management"

  prefix                             = var.prefix
  tenant_id                          = var.tenant_id
  devops_sp_object_id                = var.devops_sp_object_id
  monitoring_principal_ids           = var.monitoring_principal_ids
  aks_workload_identity_principal_id = module.aks.kubelet_identity_object_id
  key_vault_id                       = module.hub.key_vault_id
  tags                               = local.common_tags
}

module "monitoring" {
  source = "./modules/monitoring"

  prefix                     = var.prefix
  environment                = var.environment
  location                   = var.location
  resource_group_name        = azurerm_resource_group.main.name
  aks_cluster_id             = module.aks.cluster_id
  log_analytics_workspace_id = module.aks.log_analytics_workspace_id
  alert_email                = var.alert_email
  tags                       = local.common_tags
}

module "policy" {
  source = "./modules/policy"

  management_group_id        = module.management.autoflow_mg_id
  log_analytics_workspace_id = module.aks.log_analytics_workspace_id
  location                   = var.location
  allowed_locations          = [var.location]
  tags                       = local.common_tags
}

module "security" {
  source = "./modules/security"

  log_analytics_workspace_id   = module.aks.log_analytics_workspace_id
  alert_email                  = var.alert_email
  enable_app_services_defender = false
  tags                         = local.common_tags
}

# ── Entra External ID (CIAM) ─────────────────────────────────────────────────
# Provisions the customer-facing identity tenant and SPA app registration.
# Use infra/azure/scripts/sync-ciam-redirect-uris.sh to keep the existing app
# registration aligned with the dashboard's current auth callback/logout paths.
# Requires the deploying SP to have Contributor on the subscription and
# Microsoft.AzureActiveDirectory resource provider registered.

module "entra_ciam" {
  source = "./modules/entra-ciam"

  prefix                = var.prefix
  environment           = var.environment
  location              = var.location
  resource_group_name   = azurerm_resource_group.main.name
  ciam_tenant_subdomain = var.ciam_tenant_subdomain
  spa_redirect_uris     = var.spa_redirect_uris
  spa_logout_uris       = var.spa_logout_uris
  tags                  = local.common_tags
}

# ── Locals ────────────────────────────────────────────────────────────────────

locals {
  common_tags = {
    project     = var.prefix
    environment = var.environment
    managed_by  = "terraform"
    repo        = "github.com/helloautoflow/paperclipai"
  }
}
