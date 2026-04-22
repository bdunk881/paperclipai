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
  description = "Name of the resource group to deploy hub resources into"
  type        = string
}

variable "enable_firewall" {
  description = "Whether to deploy Azure Firewall resources in the hub"
  type        = bool
  default     = false
}

variable "enable_bastion" {
  description = "Whether to deploy Azure Bastion resources in the hub"
  type        = bool
  default     = false
}

variable "hub_vnet_address_space" {
  description = "CIDR block for the hub virtual network"
  type        = string
  default     = "10.1.0.0/16"
}

variable "firewall_subnet_cidr" {
  description = "CIDR for AzureFirewallSubnet (must be at least /26)"
  type        = string
  default     = "10.1.0.0/26"
}

variable "bastion_subnet_cidr" {
  description = "CIDR for AzureBastionSubnet (must be at least /27)"
  type        = string
  default     = "10.1.1.0/27"
}

variable "gateway_subnet_cidr" {
  description = "CIDR for GatewaySubnet"
  type        = string
  default     = "10.1.2.0/27"
}

variable "mgmt_subnet_cidr" {
  description = "CIDR for management subnet"
  type        = string
  default     = "10.1.3.0/24"
}

variable "key_vault_sku" {
  description = "SKU for Azure Key Vault (standard or premium)"
  type        = string
  default     = "standard"
}

variable "tenant_id" {
  description = "Azure tenant ID (used for Key Vault)"
  type        = string
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
