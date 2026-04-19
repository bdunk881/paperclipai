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

variable "enable_hub_firewall" {
  description = "Whether to deploy Azure Firewall resources in the hub"
  type        = bool
  default     = false
}

variable "enable_hub_bastion" {
  description = "Whether to deploy Azure Bastion resources in the hub"
  type        = bool
  default     = false
}

# ── Azure Identity ────────────────────────────────────────────────────────────

variable "tenant_id" {
  description = "Azure AD tenant ID (used by Key Vault and identity resources)"
  type        = string
}

# ── Management / RBAC ────────────────────────────────────────────────────────

variable "devops_sp_object_id" {
  description = "Object ID of the DevOps pipeline service principal; granted Contributor on Landing Zone MGs"
  type        = string
}

variable "monitoring_principal_ids" {
  description = "Object IDs of monitoring agents; granted Monitoring Reader at the autoflow management group"
  type        = list(string)
  default     = []
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

# ── Entra External ID (CIAM) ──────────────────────────────────────────────────

variable "ciam_tenant_subdomain" {
  description = "Subdomain for the CIAM tenant (e.g. 'autoflow' → autoflow.ciamlogin.com). Must be globally unique."
  type        = string
  default     = "autoflow"
}

variable "spa_redirect_uris" {
  description = "SPA redirect URIs for the CIAM app registration"
  type        = list(string)
  default     = ["http://localhost:5173"]
}

variable "spa_logout_uris" {
  description = "Post-logout redirect URIs for the SPA"
  type        = list(string)
  default     = ["http://localhost:5173/login"]
}

# ── Monitoring ────────────────────────────────────────────────────────────────

variable "alert_email" {
  description = "Email address for monitoring alerts"
  type        = string
}
