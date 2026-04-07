data "azurerm_client_config" "current" {}

# ─── Azure Key Vault ──────────────────────────────────────────────────────────

resource "azurerm_key_vault" "main" {
  name                        = "kv-${local.prefix}"
  resource_group_name         = azurerm_resource_group.main.name
  location                    = azurerm_resource_group.main.location
  sku_name                    = "standard"
  tenant_id                   = data.azurerm_client_config.current.tenant_id
  purge_protection_enabled    = true
  soft_delete_retention_days  = 7
  enable_rbac_authorization   = false

  network_acls {
    default_action = "Allow"
    bypass         = "AzureServices"
  }

  tags = local.tags
}

# Access policy for Terraform itself (to write secrets during apply)
resource "azurerm_key_vault_access_policy" "terraform_admin" {
  key_vault_id = azurerm_key_vault.main.id
  tenant_id    = data.azurerm_client_config.current.tenant_id
  object_id    = data.azurerm_client_config.current.object_id

  secret_permissions = ["Get", "List", "Set", "Delete", "Purge", "Recover"]
  key_permissions    = ["Get", "List", "Create", "Delete", "Recover", "Purge"]
}

# Access policy for the app managed identity (read secrets at runtime)
resource "azurerm_key_vault_access_policy" "app" {
  key_vault_id = azurerm_key_vault.main.id
  tenant_id    = data.azurerm_client_config.current.tenant_id
  object_id    = azurerm_user_assigned_identity.app.principal_id

  secret_permissions = ["Get", "List"]
  key_permissions    = ["Get", "List"]
}

# Access policy for GitHub Actions service principal (needed for Terraform apply in CI)
resource "azurerm_key_vault_access_policy" "github_actions" {
  key_vault_id = azurerm_key_vault.main.id
  tenant_id    = data.azurerm_client_config.current.tenant_id
  object_id    = azuread_service_principal.github_actions.object_id

  secret_permissions = ["Get", "List", "Set", "Delete", "Purge", "Recover"]
  key_permissions    = ["Get", "List", "Create", "Delete", "Recover", "Purge"]
}
