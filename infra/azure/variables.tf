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

variable "autoflow_management_group_name" {
  description = "Azure name/UUID for the existing top-level autoflow management group."
  type        = string
  default     = "f4e6c3a4-6ee6-4604-8334-413e481dcf27"
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

variable "production_kubernetes_version" {
  description = "Pinned Kubernetes version for the live production AKS cluster."
  type        = string
  default     = "1.35.1"
}

variable "production_node_count" {
  description = "Pinned default node count for the live production AKS cluster."
  type        = number
  default     = 2
}

variable "production_node_vm_size" {
  description = "Pinned node VM size for the live production AKS cluster."
  type        = string
  default     = "Standard_D2as_v7"
}

variable "production_min_node_count" {
  description = "Pinned minimum node count for the live production AKS cluster."
  type        = number
  default     = 2
}

variable "production_max_node_count" {
  description = "Pinned maximum node count for the live production AKS cluster."
  type        = number
  default     = 10
}

variable "api_server_authorized_ips" {
  description = "Stable CIDR blocks allowed to reach the AKS API server. Use only fixed egress ranges such as VPN, hub management, or self-hosted runner subnets."
  type        = list(string)
  default = [
    "10.1.3.0/24", # Hub management / bastion subnet
  ]
}

# ── Entra External ID (CIAM) ──────────────────────────────────────────────────

variable "ciam_tenant_subdomain" {
  description = "Subdomain for the CIAM tenant (e.g. 'autoflow' → autoflow.ciamlogin.com). Must be globally unique."
  type        = string
  default     = "autoflowciam"
}

variable "existing_ciam_tenant_id" {
  description = "Existing CIAM tenant ID reused by Terraform outputs and app registration wiring."
  type        = string
  default     = "5e4f1080-8afc-4005-b05e-32b21e69363a"
}

variable "spa_redirect_uris" {
  description = "SPA redirect URIs for the CIAM app registration"
  type        = list(string)
  default = [
    "http://localhost:5173",
    "http://localhost:5173/auth/callback",
    "http://localhost:5173/login",
    "https://staging.app.helloautoflow.com/auth/callback",
    "https://staging.app.helloautoflow.com/login",
    "https://app.helloautoflow.com/auth/callback",
    "https://app.helloautoflow.com/login",
  ]
}

variable "spa_logout_uris" {
  description = "Legacy post-logout redirect URIs for the SPA. Keep in sync with spa_redirect_uris."
  type        = list(string)
  default     = ["http://localhost:5173/login", "https://staging.app.helloautoflow.com/login", "https://app.helloautoflow.com/login"]
}

# ── Monitoring ────────────────────────────────────────────────────────────────

variable "alert_email" {
  description = "Email address for monitoring alerts"
  type        = string
}
