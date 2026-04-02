variable "prefix" {
  description = "Short project prefix used in all resource names"
  type        = string
  default     = "autoflow"
}

variable "environment" {
  description = "Deployment environment: staging or production"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be 'staging' or 'production'."
  }
}

variable "location" {
  description = "Azure region for all resources"
  type        = string
  default     = "eastus2"
}

# ── Azure Identity ────────────────────────────────────────────────────────────

variable "tenant_id" {
  description = "Azure AD tenant ID (used by Key Vault and identity resources)"
  type        = string
}

# ── Networking ────────────────────────────────────────────────────────────────

variable "vnet_address_space" {
  description = "CIDR block for the virtual network"
  type        = string
  default     = "10.0.0.0/16"
}

variable "aks_subnet_cidr" {
  description = "CIDR block for AKS node subnet"
  type        = string
  default     = "10.0.1.0/24"
}

variable "pe_subnet_cidr" {
  description = "CIDR block for private endpoint subnet"
  type        = string
  default     = "10.0.2.0/24"
}

# ── AKS ───────────────────────────────────────────────────────────────────────

variable "kubernetes_version" {
  description = "Kubernetes version for the AKS cluster"
  type        = string
  default     = "1.29"
}

variable "node_count" {
  description = "Initial node count for the default node pool"
  type        = number
  default     = 2
}

variable "node_vm_size" {
  description = "VM size for AKS nodes"
  type        = string
  default     = "Standard_B2s"
}

variable "min_node_count" {
  description = "Minimum nodes for autoscaling"
  type        = number
  default     = 1
}

variable "max_node_count" {
  description = "Maximum nodes for autoscaling"
  type        = number
  default     = 5
}

# ── Monitoring ────────────────────────────────────────────────────────────────

variable "alert_email" {
  description = "Email address for monitoring alerts"
  type        = string
}
