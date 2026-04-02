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

  # DNS proxy required so spoke VNets (which use the firewall IP as DNS server)
  # can resolve FQDNs via the firewall and so FQDN-based network rules work.
  dns {
    proxy_enabled = true
  }

  tags = var.tags
}

# ── AKS Egress Rule Collection Group ─────────────────────────────────────────
# Allows AKS nodes and pods to reach required external endpoints through the
# Hub Firewall.  Priority 1000 is evaluated before the default-deny at 65000.
# Source addresses use "*" — traffic arrives here only via spoke UDRs, so the
# firewall is already the sole egress path.

resource "azurerm_firewall_policy_rule_collection_group" "aks_egress" {
  name               = "aks-egress"
  firewall_policy_id = azurerm_firewall_policy.hub.id
  priority           = 1000

  # ── Application Rules (FQDN-based HTTP/HTTPS) ────────────────────────────

  application_rule_collection {
    name     = "aks-required-fqdns"
    priority = 100
    action   = "Allow"

    # Microsoft Container Registry — required for AKS system images
    rule {
      name             = "allow-mcr"
      source_addresses = ["*"]
      target_fqdns     = ["mcr.microsoft.com", "*.data.mcr.microsoft.com"]
      protocols {
        type = "Https"
        port = 443
      }
    }

    # AKS management plane & Azure APIs
    rule {
      name             = "allow-aks-management"
      source_addresses = ["*"]
      target_fqdns = [
        "management.azure.com",
        "login.microsoftonline.com",
        "*.hcp.${var.location}.azmk8s.io",
      ]
      protocols {
        type = "Https"
        port = 443
      }
    }

    # Azure Container Registry (private endpoint traffic also needs FQDN allow)
    rule {
      name             = "allow-acr"
      source_addresses = ["*"]
      target_fqdns     = ["*.azurecr.io"]
      protocols {
        type = "Https"
        port = 443
      }
    }

    # Azure Key Vault
    rule {
      name             = "allow-keyvault"
      source_addresses = ["*"]
      target_fqdns     = ["*.vault.azure.net"]
      protocols {
        type = "Https"
        port = 443
      }
    }

    # Azure Monitor / Log Analytics / App Insights
    rule {
      name             = "allow-azure-monitor"
      source_addresses = ["*"]
      target_fqdns = [
        "dc.services.visualstudio.com",
        "*.ods.opinsights.azure.com",
        "*.oms.opinsights.azure.com",
        "*.monitoring.azure.com",
      ]
      protocols {
        type = "Https"
        port = 443
      }
    }

    # Docker Hub — node image pulls (system containers)
    rule {
      name             = "allow-docker-hub"
      source_addresses = ["*"]
      target_fqdns = [
        "docker.io",
        "registry-1.docker.io",
        "auth.docker.io",
        "index.docker.io",
        "production.cloudflare.docker.com",
      ]
      protocols {
        type = "Https"
        port = 443
      }
    }

    # Ubuntu OS updates (AKS node OS)
    rule {
      name             = "allow-ubuntu-updates"
      source_addresses = ["*"]
      target_fqdns = [
        "security.ubuntu.com",
        "azure.archive.ubuntu.com",
        "changelogs.ubuntu.com",
      ]
      protocols {
        type = "Http"
        port = 80
      }
      protocols {
        type = "Https"
        port = 443
      }
    }

    # GitHub (Helm charts, Flux, tooling)
    rule {
      name             = "allow-github"
      source_addresses = ["*"]
      target_fqdns     = ["github.com", "*.githubusercontent.com"]
      protocols {
        type = "Https"
        port = 443
      }
    }

    # Helm chart repositories
    rule {
      name             = "allow-helm"
      source_addresses = ["*"]
      target_fqdns     = ["charts.helm.sh", "*.helm.sh"]
      protocols {
        type = "Https"
        port = 443
      }
    }

    # Google Container Registry (some AKS add-on images)
    rule {
      name             = "allow-gcr"
      source_addresses = ["*"]
      target_fqdns     = ["gcr.io", "*.gcr.io", "storage.googleapis.com"]
      protocols {
        type = "Https"
        port = 443
      }
    }

    # Quay.io (Red Hat / community images)
    rule {
      name             = "allow-quay"
      source_addresses = ["*"]
      target_fqdns     = ["quay.io", "*.quay.io"]
      protocols {
        type = "Https"
        port = 443
      }
    }
  }

  # ── Network Rules (IP/port based) ─────────────────────────────────────────

  network_rule_collection {
    name     = "aks-required-network"
    priority = 200
    action   = "Allow"

    # Azure DNS — required for FQDN resolution through the firewall DNS proxy
    rule {
      name                  = "allow-azure-dns"
      protocols             = ["UDP"]
      source_addresses      = ["*"]
      destination_addresses = ["168.63.129.16"]
      destination_ports     = ["53"]
    }

    # NTP — node clock synchronisation
    rule {
      name                  = "allow-ntp"
      protocols             = ["UDP"]
      source_addresses      = ["*"]
      destination_fqdns     = ["ntp.ubuntu.com"]
      destination_ports     = ["123"]
    }

    # Azure backbone services via service tags
    rule {
      name                  = "allow-azure-cloud"
      protocols             = ["TCP"]
      source_addresses      = ["*"]
      destination_addresses = ["AzureCloud"]
      destination_ports     = ["443"]
    }

    # Azure Monitor data ingestion
    rule {
      name                  = "allow-azure-monitor"
      protocols             = ["TCP"]
      source_addresses      = ["*"]
      destination_addresses = ["AzureMonitor"]
      destination_ports     = ["443"]
    }
  }
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
