# ─── Private DNS zone for PostgreSQL ─────────────────────────────────────────

resource "azurerm_private_dns_zone" "postgres" {
  name                = "${local.prefix}.private.postgres.database.azure.com"
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "postgres" {
  name                  = "link-postgres-${local.prefix}"
  resource_group_name   = azurerm_resource_group.main.name
  private_dns_zone_name = azurerm_private_dns_zone.postgres.name
  virtual_network_id    = azurerm_virtual_network.main.id
  registration_enabled  = false
  tags                  = local.tags
}

# ─── PostgreSQL Flexible Server ───────────────────────────────────────────────

resource "random_password" "postgres" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}:?"
}

resource "azurerm_postgresql_flexible_server" "main" {
  name                   = "psql-${local.prefix}"
  resource_group_name    = azurerm_resource_group.main.name
  location               = azurerm_resource_group.main.location
  version                = var.postgres_version
  delegated_subnet_id    = azurerm_subnet.private_endpoints.id
  private_dns_zone_id    = azurerm_private_dns_zone.postgres.id
  administrator_login    = var.postgres_admin_username
  administrator_password = random_password.postgres.result
  storage_mb             = var.postgres_storage_mb
  sku_name               = var.postgres_sku
  zone                   = "1"

  backup_retention_days        = 7
  geo_redundant_backup_enabled = false

  tags = local.tags

  depends_on = [azurerm_private_dns_zone_virtual_network_link.postgres]
}

resource "azurerm_postgresql_flexible_server_database" "app" {
  name      = "autoflow"
  server_id = azurerm_postgresql_flexible_server.main.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

# Store the connection string in Key Vault (see keyvault.tf for the vault)
resource "azurerm_key_vault_secret" "database_url" {
  name         = "DATABASE-URL"
  value        = "postgresql://${var.postgres_admin_username}:${random_password.postgres.result}@${azurerm_postgresql_flexible_server.main.fqdn}:5432/${azurerm_postgresql_flexible_server_database.app.name}?sslmode=require"
  key_vault_id = azurerm_key_vault.main.id
  tags         = local.tags

  depends_on = [azurerm_key_vault_access_policy.terraform_admin]
}
