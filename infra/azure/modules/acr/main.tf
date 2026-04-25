resource "azurerm_container_registry" "main" {
  name                          = "${var.prefix}${var.environment}acr"
  resource_group_name           = var.resource_group_name
  location                      = var.location
  sku                           = "Premium" # Premium required for private endpoints and geo-replication
  admin_enabled                 = false     # Use workload identity / service principal only
  public_network_access_enabled = false     # All access via private endpoint

  network_rule_bypass_option = "AzureServices"

  tags = var.tags
}

# ── Private endpoint — AKS pulls images over private network ─────────────────

resource "azurerm_private_endpoint" "acr" {
  name                = "${var.prefix}-${var.environment}-acr-pe"
  location            = var.location
  resource_group_name = var.resource_group_name
  subnet_id           = var.pe_subnet_id

  private_service_connection {
    name                           = "${var.prefix}-acr-psc"
    private_connection_resource_id = azurerm_container_registry.main.id
    subresource_names              = ["registry"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "acr-dns-group"
    private_dns_zone_ids = [var.private_dns_zone_id]
  }

  tags = var.tags
}
