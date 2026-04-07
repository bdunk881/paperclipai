# ─── Azure Storage Account ────────────────────────────────────────────────────
# Replaces the hardcoded "altitudemediastorage" fallback in blob-client.ts.
# The app reads AZURE_STORAGE_ACCOUNT_NAME from its environment.

resource "azurerm_storage_account" "main" {
  name                            = "st${replace(local.prefix, "-", "")}app"
  resource_group_name             = azurerm_resource_group.main.name
  location                        = azurerm_resource_group.main.location
  account_tier                    = "Standard"
  account_replication_type        = var.storage_replication
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false

  blob_properties {
    versioning_enabled  = true
    change_feed_enabled = true

    delete_retention_policy {
      days = 7
    }

    container_delete_retention_policy {
      days = 7
    }
  }

  tags = local.tags
}

# Blob containers matching the app's config.ts CONTAINERS map
resource "azurerm_storage_container" "content_pipeline" {
  name                  = "content-pipeline"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
}

resource "azurerm_storage_container" "media_assets" {
  name                  = "media-assets"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
}

resource "azurerm_storage_container" "exports" {
  name                  = "exports"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
}

resource "azurerm_storage_container" "backups" {
  name                  = "backups"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
}

# Grant the app's managed identity Storage Blob Data Contributor
resource "azurerm_role_assignment" "app_storage_blob" {
  scope                = azurerm_storage_account.main.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}
