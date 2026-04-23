provider "azurerm" {
  features {}
  use_oidc = true
}

data "azurerm_resource_group" "this" {
  name = var.resource_group_name
}

resource "azurerm_storage_account" "this" {
  name                     = var.storage_account_name
  resource_group_name      = data.azurerm_resource_group.this.name
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  access_tier              = "Hot"

  min_tls_version                 = "TLS1_2"
  shared_access_key_enabled       = false
  default_to_oauth_authentication = true
  allow_nested_items_to_be_public = false

  blob_properties {
    delete_retention_policy {
      days = 7
    }
    container_delete_retention_policy {
      days = 7
    }
  }

  tags = {
    project     = "autoflow"
    managed_by  = "terraform"
    environment = "production"
  }
}

locals {
  containers = ["content-pipeline", "media-assets", "exports", "backups"]
}

resource "azurerm_storage_container" "this" {
  for_each              = toset(local.containers)
  name                  = each.value
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"
}

# Lifecycle policy: Cool after 30 days, Archive after 90 days
resource "azurerm_storage_management_policy" "lifecycle" {
  storage_account_id = azurerm_storage_account.this.id

  rule {
    name    = "auto-tier-to-cool"
    enabled = true

    filters {
      blob_types = ["blockBlob"]
    }

    actions {
      base_blob {
        tier_to_cool_after_days_since_modification_greater_than    = var.cool_tier_days
        tier_to_archive_after_days_since_modification_greater_than = var.archive_tier_days
      }
    }
  }
}

# RBAC: Grant Storage Blob Data Contributor to each Managed Identity
resource "azurerm_role_assignment" "blob_contributor" {
  for_each             = toset(var.managed_identity_principal_ids)
  scope                = azurerm_storage_account.this.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = each.value
}
