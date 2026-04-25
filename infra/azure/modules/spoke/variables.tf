variable "prefix" {
  description = "Short project prefix used in all resource names"
  type        = string
}

variable "environment" {
  description = "Deployment environment: staging or production"
  type        = string
}

variable "location" {
  description = "Azure region for all resources"
  type        = string
}

variable "resource_group_name" {
  description = "Resource group for spoke resources"
  type        = string
}

variable "tenant_id" {
  description = "Azure tenant ID used for spoke Key Vault creation"
  type        = string
}

# ── Network CIDRs ─────────────────────────────────────────────────────────────

variable "spoke_vnet_cidr" {
  description = "CIDR block for the spoke virtual network (e.g. 10.2.0.0/16 for prod, 10.3.0.0/16 for staging)"
  type        = string
}

variable "aks_subnet_cidr" {
  description = "CIDR block for the AKS node subnet"
  type        = string
}

variable "pe_subnet_cidr" {
  description = "CIDR block for the private endpoints subnet"
  type        = string
}

variable "svc_subnet_cidr" {
  description = "CIDR block for the services subnet"
  type        = string
}

variable "func_subnet_cidr" {
  description = "CIDR block for the functions / app-services subnet"
  type        = string
}

# ── Hub references ────────────────────────────────────────────────────────────

variable "hub_vnet_id" {
  description = "Resource ID of the hub virtual network (for VNet peering)"
  type        = string
}

variable "hub_vnet_name" {
  description = "Name of the hub virtual network (for reverse hub→spoke peering resource)"
  type        = string
}

variable "hub_resource_group_name" {
  description = "Resource group where hub VNet and private DNS zones reside"
  type        = string
}

variable "hub_firewall_private_ip" {
  description = "Optional Azure Firewall private IP for forced egress routing"
  type        = string
  default     = null
}

# ── Network Watcher ───────────────────────────────────────────────────────────

variable "network_watcher_name" {
  description = "Name of the Network Watcher in the spoke region (auto-created by Azure as NetworkWatcher_<region>)"
  type        = string
  default     = null
}

variable "network_watcher_rg" {
  description = "Resource group that contains the regional Network Watcher (Azure default: NetworkWatcherRG)"
  type        = string
  default     = "NetworkWatcherRG"
}

variable "key_vault_sku" {
  description = "SKU for the spoke Key Vault (standard or premium)"
  type        = string
  default     = "standard"
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
