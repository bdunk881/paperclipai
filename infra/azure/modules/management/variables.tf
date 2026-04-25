variable "prefix" {
  description = "Short project prefix used in all resource names"
  type        = string
}

variable "tenant_id" {
  description = "Azure AD tenant ID"
  type        = string
}

variable "existing_autoflow_management_group_name" {
  description = "Existing Autoflow management group name/ID to reuse instead of creating a new top-level group under tenant root"
  type        = string
  default     = null
}

# ── DevOps Pipeline Service Principal ────────────────────────────────────────

variable "devops_sp_object_id" {
  description = "Object ID of the DevOps pipeline service principal"
  type        = string
}

# ── Monitoring ────────────────────────────────────────────────────────────────

variable "monitoring_principal_ids" {
  description = "List of principal IDs (object IDs) for monitoring agents that need Monitoring Reader"
  type        = list(string)
  default     = []
}

# ── AKS Workload Identity ─────────────────────────────────────────────────────

variable "aks_workload_identity_principal_id" {
  description = "Object ID of the AKS workload identity (user-assigned managed identity or federated SA) needing Key Vault Secrets User"
  type        = string
}

variable "key_vault_id" {
  description = "Resource ID of the hub Key Vault for AKS workload identity RBAC assignment"
  type        = string
}

variable "tags" {
  description = "Tags applied to management group-level deployable resources"
  type        = map(string)
  default     = {}
}
