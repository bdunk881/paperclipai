# ── Hub VNet ──────────────────────────────────────────────────────────────────

resource "azurerm_virtual_network" "hub" {
  name                = "${var.prefix}-hub-vnet"
  location            = var.location
  resource_group_name = var.resource_group_name
  address_space       = [var.hub_vnet_address_space]

  tags = var.tags
}

# ── Subnets ───────────────────────────────────────────────────────────────────

resource "azurerm_subnet" "firewall" {
  name                 = "AzureFirewallSubnet"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.hub.name
  address_prefixes     = [var.firewall_subnet_cidr]
}

resource "azurerm_subnet" "bastion" {
  name                 = "AzureBastionSubnet"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.hub.name
  address_prefixes     = [var.bastion_subnet_cidr]
}

resource "azurerm_subnet" "gateway" {
  name                 = "GatewaySubnet"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.hub.name
  address_prefixes     = [var.gateway_subnet_cidr]
}

resource "azurerm_subnet" "mgmt" {
  name                 = "mgmt-subnet"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.hub.name
  address_prefixes     = [var.mgmt_subnet_cidr]
}

# ── Azure Firewall ────────────────────────────────────────────────────────────

resource "azurerm_public_ip" "firewall" {
  name                = "${var.prefix}-hub-fw-pip"
  location            = var.location
  resource_group_name = var.resource_group_name
  allocation_method   = "Static"
  sku                 = "Standard"

  tags = var.tags
}

resource "azurerm_firewall_policy" "hub" {
  name                = "${var.prefix}-hub-fw-policy"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "Standard"

  tags = var.tags
}

resource "azurerm_firewall_policy_rule_collection_group" "default_deny" {
  name               = "default-deny"
  firewall_policy_id = azurerm_firewall_policy.hub.id
  priority           = 65000

  network_rule_collection {
    name     = "deny-all-inbound"
    priority = 100
    action   = "Deny"

    rule {
      name                  = "deny-all"
      protocols             = ["Any"]
      source_addresses      = ["*"]
      destination_addresses = ["*"]
      destination_ports     = ["*"]
    }
  }
}

resource "azurerm_firewall" "hub" {
  name                = "${var.prefix}-hub-fw"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku_name            = "AZFW_VNet"
  sku_tier            = "Standard"
  firewall_policy_id  = azurerm_firewall_policy.hub.id

  ip_configuration {
    name                 = "hub-fw-ipconfig"
    subnet_id            = azurerm_subnet.firewall.id
    public_ip_address_id = azurerm_public_ip.firewall.id
  }

  tags = var.tags
}

# ── Azure Bastion ─────────────────────────────────────────────────────────────

resource "azurerm_public_ip" "bastion" {
  name                = "${var.prefix}-hub-bastion-pip"
  location            = var.location
  resource_group_name = var.resource_group_name
  allocation_method   = "Static"
  sku                 = "Standard"

  tags = var.tags
}

resource "azurerm_bastion_host" "hub" {
  name                = "${var.prefix}-hub-bastion"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "Standard"
  tunneling_enabled   = true

  ip_configuration {
    name                 = "hub-bastion-ipconfig"
    subnet_id            = azurerm_subnet.bastion.id
    public_ip_address_id = azurerm_public_ip.bastion.id
  }

  tags = var.tags
}

# ── Azure Key Vault ───────────────────────────────────────────────────────────

resource "azurerm_key_vault" "hub" {
  name                        = "${var.prefix}-hub-kv"
  location                    = var.location
  resource_group_name         = var.resource_group_name
  tenant_id                   = var.tenant_id
  sku_name                    = var.key_vault_sku
  enable_rbac_authorization   = true
  soft_delete_retention_days  = 90
  purge_protection_enabled    = true

  tags = var.tags
}

# ── Private DNS Zones ─────────────────────────────────────────────────────────

resource "azurerm_private_dns_zone" "acr" {
  name                = "privatelink.azurecr.io"
  resource_group_name = var.resource_group_name

  tags = var.tags
}

resource "azurerm_private_dns_zone" "keyvault" {
  name                = "privatelink.vaultcore.azure.net"
  resource_group_name = var.resource_group_name

  tags = var.tags
}

resource "azurerm_private_dns_zone" "blob" {
  name                = "privatelink.blob.core.windows.net"
  resource_group_name = var.resource_group_name

  tags = var.tags
}

# ── DNS Zone VNet Links ───────────────────────────────────────────────────────

resource "azurerm_private_dns_zone_virtual_network_link" "acr_hub" {
  name                  = "${var.prefix}-hub-acr-dns-link"
  resource_group_name   = var.resource_group_name
  private_dns_zone_name = azurerm_private_dns_zone.acr.name
  virtual_network_id    = azurerm_virtual_network.hub.id
  registration_enabled  = false

  tags = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "keyvault_hub" {
  name                  = "${var.prefix}-hub-kv-dns-link"
  resource_group_name   = var.resource_group_name
  private_dns_zone_name = azurerm_private_dns_zone.keyvault.name
  virtual_network_id    = azurerm_virtual_network.hub.id
  registration_enabled  = false

  tags = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "blob_hub" {
  name                  = "${var.prefix}-hub-blob-dns-link"
  resource_group_name   = var.resource_group_name
  private_dns_zone_name = azurerm_private_dns_zone.blob.name
  virtual_network_id    = azurerm_virtual_network.hub.id
  registration_enabled  = false

  tags = var.tags
}
