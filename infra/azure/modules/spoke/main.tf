# ── Locals ───────────────────────────────────────────────────────────────────

locals {
  # Azure auto-creates a Network Watcher per region; derive name if not supplied.
  network_watcher_name = coalesce(var.network_watcher_name, "NetworkWatcher_${var.location}")

  # Storage account names: lowercase alphanumeric, max 24 chars.
  flow_log_sa_name = lower(replace("${var.prefix}${var.environment}flow", "-", ""))

  # Fall back to direct internet egress when the hub firewall is intentionally disabled.
  default_route_next_hop_type = var.hub_firewall_private_ip != null ? "VirtualAppliance" : "Internet"
  key_vault_name              = lower(substr(replace("${var.prefix}-${var.environment}-kv", "-", ""), 0, 24))
}

# ── Log Analytics workspace for spoke NSG flow log traffic analytics ──────────
# A dedicated workspace per spoke avoids circular dependencies with the AKS
# module (which creates its own workspace for container insights).

resource "azurerm_log_analytics_workspace" "spoke" {
  name                = "${var.prefix}-${var.environment}-spoke-logs"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "PerGB2018"
  retention_in_days   = 30

  tags = var.tags
}

# ── Spoke VNet ────────────────────────────────────────────────────────────────

resource "azurerm_virtual_network" "spoke" {
  name                = "${var.prefix}-${var.environment}-spoke-vnet"
  location            = var.location
  resource_group_name = var.resource_group_name
  address_space       = [var.spoke_vnet_cidr]

  tags = var.tags
}

# ── Subnets ───────────────────────────────────────────────────────────────────

resource "azurerm_subnet" "aks" {
  name                 = "aks-subnet"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.spoke.name
  address_prefixes     = [var.aks_subnet_cidr]
}

resource "azurerm_subnet" "pe" {
  name                 = "pe-subnet"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.spoke.name
  address_prefixes     = [var.pe_subnet_cidr]

  private_endpoint_network_policies_enabled = true
}

resource "azurerm_subnet" "svc" {
  name                 = "svc-subnet"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.spoke.name
  address_prefixes     = [var.svc_subnet_cidr]
}

resource "azurerm_subnet" "func" {
  name                 = "func-subnet"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.spoke.name
  address_prefixes     = [var.func_subnet_cidr]
}

# ── Network Security Groups ───────────────────────────────────────────────────

resource "azurerm_network_security_group" "aks" {
  name                = "${var.prefix}-${var.environment}-spoke-aks-nsg"
  location            = var.location
  resource_group_name = var.resource_group_name

  # Allow intra-VNet traffic (hub peering included via VirtualNetwork service tag).
  security_rule {
    name                       = "allow-vnet-inbound"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "VirtualNetwork"
    destination_address_prefix = "*"
  }

  # AKS control-plane health probes over HTTPS.
  security_rule {
    name                       = "allow-azure-lb-inbound"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "AzureLoadBalancer"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "deny-internet-inbound"
    priority                   = 4000
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }

  tags = var.tags
}

resource "azurerm_network_security_group" "pe" {
  name                = "${var.prefix}-${var.environment}-spoke-pe-nsg"
  location            = var.location
  resource_group_name = var.resource_group_name

  security_rule {
    name                       = "allow-vnet-inbound"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "VirtualNetwork"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "deny-all-inbound"
    priority                   = 4000
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  tags = var.tags
}

resource "azurerm_network_security_group" "svc" {
  name                = "${var.prefix}-${var.environment}-spoke-svc-nsg"
  location            = var.location
  resource_group_name = var.resource_group_name

  security_rule {
    name                       = "allow-vnet-inbound"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "VirtualNetwork"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "deny-internet-inbound"
    priority                   = 4000
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }

  tags = var.tags
}

resource "azurerm_network_security_group" "func" {
  name                = "${var.prefix}-${var.environment}-spoke-func-nsg"
  location            = var.location
  resource_group_name = var.resource_group_name

  security_rule {
    name                       = "allow-vnet-inbound"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "VirtualNetwork"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "deny-internet-inbound"
    priority                   = 4000
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }

  tags = var.tags
}

# ── NSG → Subnet associations ─────────────────────────────────────────────────

resource "azurerm_subnet_network_security_group_association" "aks" {
  subnet_id                 = azurerm_subnet.aks.id
  network_security_group_id = azurerm_network_security_group.aks.id
}

resource "azurerm_subnet_network_security_group_association" "pe" {
  subnet_id                 = azurerm_subnet.pe.id
  network_security_group_id = azurerm_network_security_group.pe.id
}

resource "azurerm_subnet_network_security_group_association" "svc" {
  subnet_id                 = azurerm_subnet.svc.id
  network_security_group_id = azurerm_network_security_group.svc.id
}

resource "azurerm_subnet_network_security_group_association" "func" {
  subnet_id                 = azurerm_subnet.func.id
  network_security_group_id = azurerm_network_security_group.func.id
}

# ── Storage account for NSG flow log retention ────────────────────────────────

resource "azurerm_storage_account" "flow_logs" {
  name                     = local.flow_log_sa_name
  resource_group_name      = var.resource_group_name
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"

  tags = var.tags
}

# ── Key Vault ────────────────────────────────────────────────────────────────

resource "azurerm_key_vault" "spoke" {
  name                       = local.key_vault_name
  location                   = var.location
  resource_group_name        = var.resource_group_name
  tenant_id                  = var.tenant_id
  sku_name                   = var.key_vault_sku
  enable_rbac_authorization  = true
  soft_delete_retention_days = 90
  purge_protection_enabled   = true

  tags = var.tags
}

# ── NSG Flow Logs (v2 + Traffic Analytics → Log Analytics) ───────────────────

resource "azurerm_network_watcher_flow_log" "aks" {
  name                      = "${var.prefix}-${var.environment}-spoke-aks-flowlog"
  network_watcher_name      = local.network_watcher_name
  resource_group_name       = var.network_watcher_rg
  network_security_group_id = azurerm_network_security_group.aks.id
  storage_account_id        = azurerm_storage_account.flow_logs.id
  enabled                   = true
  version                   = 2

  retention_policy {
    enabled = true
    days    = 30
  }

  traffic_analytics {
    enabled               = true
    workspace_id          = azurerm_log_analytics_workspace.spoke.workspace_id
    workspace_region      = var.location
    workspace_resource_id = azurerm_log_analytics_workspace.spoke.id
    interval_in_minutes   = 10
  }

  tags = var.tags
}

resource "azurerm_network_watcher_flow_log" "pe" {
  name                      = "${var.prefix}-${var.environment}-spoke-pe-flowlog"
  network_watcher_name      = local.network_watcher_name
  resource_group_name       = var.network_watcher_rg
  network_security_group_id = azurerm_network_security_group.pe.id
  storage_account_id        = azurerm_storage_account.flow_logs.id
  enabled                   = true
  version                   = 2

  retention_policy {
    enabled = true
    days    = 30
  }

  traffic_analytics {
    enabled               = true
    workspace_id          = azurerm_log_analytics_workspace.spoke.workspace_id
    workspace_region      = var.location
    workspace_resource_id = azurerm_log_analytics_workspace.spoke.id
    interval_in_minutes   = 10
  }

  tags = var.tags
}

resource "azurerm_network_watcher_flow_log" "svc" {
  name                      = "${var.prefix}-${var.environment}-spoke-svc-flowlog"
  network_watcher_name      = local.network_watcher_name
  resource_group_name       = var.network_watcher_rg
  network_security_group_id = azurerm_network_security_group.svc.id
  storage_account_id        = azurerm_storage_account.flow_logs.id
  enabled                   = true
  version                   = 2

  retention_policy {
    enabled = true
    days    = 30
  }

  traffic_analytics {
    enabled               = true
    workspace_id          = azurerm_log_analytics_workspace.spoke.workspace_id
    workspace_region      = var.location
    workspace_resource_id = azurerm_log_analytics_workspace.spoke.id
    interval_in_minutes   = 10
  }

  tags = var.tags
}

resource "azurerm_network_watcher_flow_log" "func" {
  name                      = "${var.prefix}-${var.environment}-spoke-func-flowlog"
  network_watcher_name      = local.network_watcher_name
  resource_group_name       = var.network_watcher_rg
  network_security_group_id = azurerm_network_security_group.func.id
  storage_account_id        = azurerm_storage_account.flow_logs.id
  enabled                   = true
  version                   = 2

  retention_policy {
    enabled = true
    days    = 30
  }

  traffic_analytics {
    enabled               = true
    workspace_id          = azurerm_log_analytics_workspace.spoke.workspace_id
    workspace_region      = var.location
    workspace_resource_id = azurerm_log_analytics_workspace.spoke.id
    interval_in_minutes   = 10
  }

  tags = var.tags
}

# ── Route Tables + UDRs (default internet egress) ────────────────────────────
# Firewall force-tunneling has been removed to avoid always-on hub firewall
# spend when firewall is disabled in the hub module.

resource "azurerm_route_table" "aks" {
  name                          = "${var.prefix}-${var.environment}-spoke-aks-rt"
  location                      = var.location
  resource_group_name           = var.resource_group_name
  disable_bgp_route_propagation = true

  route {
    name                   = "default-to-internet"
    address_prefix         = "0.0.0.0/0"
    next_hop_type          = local.default_route_next_hop_type
    next_hop_in_ip_address = var.hub_firewall_private_ip
  }

  tags = var.tags
}

resource "azurerm_route_table" "pe" {
  name                          = "${var.prefix}-${var.environment}-spoke-pe-rt"
  location                      = var.location
  resource_group_name           = var.resource_group_name
  disable_bgp_route_propagation = true

  route {
    name                   = "default-to-internet"
    address_prefix         = "0.0.0.0/0"
    next_hop_type          = local.default_route_next_hop_type
    next_hop_in_ip_address = var.hub_firewall_private_ip
  }

  tags = var.tags
}

resource "azurerm_route_table" "svc" {
  name                          = "${var.prefix}-${var.environment}-spoke-svc-rt"
  location                      = var.location
  resource_group_name           = var.resource_group_name
  disable_bgp_route_propagation = true

  route {
    name                   = "default-to-internet"
    address_prefix         = "0.0.0.0/0"
    next_hop_type          = local.default_route_next_hop_type
    next_hop_in_ip_address = var.hub_firewall_private_ip
  }

  tags = var.tags
}

resource "azurerm_route_table" "func" {
  name                          = "${var.prefix}-${var.environment}-spoke-func-rt"
  location                      = var.location
  resource_group_name           = var.resource_group_name
  disable_bgp_route_propagation = true

  route {
    name                   = "default-to-internet"
    address_prefix         = "0.0.0.0/0"
    next_hop_type          = local.default_route_next_hop_type
    next_hop_in_ip_address = var.hub_firewall_private_ip
  }

  tags = var.tags
}

# ── Route Table → Subnet associations ─────────────────────────────────────────

resource "azurerm_subnet_route_table_association" "aks" {
  subnet_id      = azurerm_subnet.aks.id
  route_table_id = azurerm_route_table.aks.id
}

resource "azurerm_subnet_route_table_association" "pe" {
  subnet_id      = azurerm_subnet.pe.id
  route_table_id = azurerm_route_table.pe.id
}

resource "azurerm_subnet_route_table_association" "svc" {
  subnet_id      = azurerm_subnet.svc.id
  route_table_id = azurerm_route_table.svc.id
}

resource "azurerm_subnet_route_table_association" "func" {
  subnet_id      = azurerm_subnet.func.id
  route_table_id = azurerm_route_table.func.id
}

# ── VNet Peering — bidirectional ──────────────────────────────────────────────

# spoke → hub: allow private traffic between hub and spoke VNets.
resource "azurerm_virtual_network_peering" "spoke_to_hub" {
  name                      = "${var.prefix}-${var.environment}-spoke-to-hub"
  resource_group_name       = var.resource_group_name
  virtual_network_name      = azurerm_virtual_network.spoke.name
  remote_virtual_network_id = var.hub_vnet_id
  allow_forwarded_traffic   = true
  allow_gateway_transit     = false
  use_remote_gateways       = false
}

# hub → spoke: hub initiates peering back so both sides are connected.
resource "azurerm_virtual_network_peering" "hub_to_spoke" {
  name                      = "${var.prefix}-hub-to-${var.environment}-spoke"
  resource_group_name       = var.hub_resource_group_name
  virtual_network_name      = var.hub_vnet_name
  remote_virtual_network_id = azurerm_virtual_network.spoke.id
  allow_forwarded_traffic   = true
  allow_gateway_transit     = true
  use_remote_gateways       = false
}

# ── Private DNS Zone links (spoke linked to Hub-managed zones) ─────────────────
# Zones live in hub_resource_group_name; each spoke adds its own link.

resource "azurerm_private_dns_zone_virtual_network_link" "acr" {
  name                  = "${var.prefix}-${var.environment}-spoke-acr-dns-link"
  resource_group_name   = var.hub_resource_group_name
  private_dns_zone_name = "privatelink.azurecr.io"
  virtual_network_id    = azurerm_virtual_network.spoke.id
  registration_enabled  = false

  tags = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "keyvault" {
  name                  = "${var.prefix}-${var.environment}-spoke-kv-dns-link"
  resource_group_name   = var.hub_resource_group_name
  private_dns_zone_name = "privatelink.vaultcore.azure.net"
  virtual_network_id    = azurerm_virtual_network.spoke.id
  registration_enabled  = false

  tags = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "blob" {
  name                  = "${var.prefix}-${var.environment}-spoke-blob-dns-link"
  resource_group_name   = var.hub_resource_group_name
  private_dns_zone_name = "privatelink.blob.core.windows.net"
  virtual_network_id    = azurerm_virtual_network.spoke.id
  registration_enabled  = false

  tags = var.tags
}
