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
    key                  = "autoflow.tfstate"
  }
}

provider "azurerm" {
  features {
    resource_group {
      prevent_deletion_if_contains_resources = false
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

module "networking" {
  source = "./modules/networking"

  prefix              = var.prefix
  environment         = var.environment
  location            = var.location
  resource_group_name = azurerm_resource_group.main.name
  vnet_address_space  = var.vnet_address_space
  aks_subnet_cidr     = var.aks_subnet_cidr
  pe_subnet_cidr      = var.pe_subnet_cidr
  tags                = local.common_tags
}

module "acr" {
  source = "./modules/acr"

  prefix              = var.prefix
  environment         = var.environment
  location            = var.location
  resource_group_name = azurerm_resource_group.main.name
  pe_subnet_id        = module.networking.pe_subnet_id
  vnet_id             = module.networking.vnet_id
  tags                = local.common_tags
}

module "aks" {
  source = "./modules/aks"

  prefix                    = var.prefix
  environment               = var.environment
  location                  = var.location
  resource_group_name       = azurerm_resource_group.main.name
  aks_subnet_id             = module.networking.aks_subnet_id
  acr_id                    = module.acr.acr_id
  node_count                = var.node_count
  node_vm_size              = var.node_vm_size
  min_node_count            = var.min_node_count
  max_node_count            = var.max_node_count
  kubernetes_version        = var.kubernetes_version
  tags                      = local.common_tags
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

# ── Locals ────────────────────────────────────────────────────────────────────

locals {
  common_tags = {
    project     = var.prefix
    environment = var.environment
    managed_by  = "terraform"
    repo        = "github.com/helloautoflow/paperclipai"
  }
}
