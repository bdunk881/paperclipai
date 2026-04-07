# ─── Private DNS zone for Redis ───────────────────────────────────────────────

resource "azurerm_private_dns_zone" "redis" {
  name                = "privatelink.redis.cache.windows.net"
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "redis" {
  name                  = "link-redis-${local.prefix}"
  resource_group_name   = azurerm_resource_group.main.name
  private_dns_zone_name = azurerm_private_dns_zone.redis.name
  virtual_network_id    = azurerm_virtual_network.main.id
  registration_enabled  = false
  tags                  = local.tags
}

# ─── Azure Cache for Redis ────────────────────────────────────────────────────

resource "azurerm_redis_cache" "main" {
  name                          = "redis-${local.prefix}"
  resource_group_name           = azurerm_resource_group.main.name
  location                      = azurerm_resource_group.main.location
  capacity                      = var.redis_capacity
  family                        = var.redis_family
  sku_name                      = var.redis_sku
  enable_non_ssl_port           = false
  minimum_tls_version           = "1.2"
  public_network_access_enabled = false

  redis_configuration {
    maxmemory_policy = "allkeys-lru"
  }

  tags = local.tags
}

# Private endpoint for Redis
resource "azurerm_private_endpoint" "redis" {
  name                = "pe-redis-${local.prefix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  subnet_id           = azurerm_subnet.private_endpoints.id
  tags                = local.tags

  private_service_connection {
    name                           = "psc-redis-${local.prefix}"
    private_connection_resource_id = azurerm_redis_cache.main.id
    subresource_names              = ["redisCache"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "dns-redis"
    private_dns_zone_ids = [azurerm_private_dns_zone.redis.id]
  }
}

# Store the Redis connection string in Key Vault
resource "azurerm_key_vault_secret" "redis_url" {
  name         = "REDIS-URL"
  value        = "rediss://:${azurerm_redis_cache.main.primary_access_key}@${azurerm_redis_cache.main.hostname}:6380"
  key_vault_id = azurerm_key_vault.main.id
  tags         = local.tags

  depends_on = [azurerm_key_vault_access_policy.terraform_admin]
}
