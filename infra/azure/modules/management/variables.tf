variable "prefix" {
  description = "Short project prefix used in all resource names"
  type        = string
}

variable "autoflow_management_group_name" {
  description = "Azure name/UUID of the existing top-level autoflow management group."
  type        = string
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

# ── Workload Key Vault Access ─────────────────────────────────────────────────

variable "key_vault_secrets_user_principal_ids" {
  description = "Object IDs for workload managed identities that need Key Vault Secrets User on the hub Key Vault"
  type        = list(string)
  default     = []
}

variable "key_vault_id" {
  description = "Resource ID of the hub Key Vault for workload RBAC assignments"
  type        = string
}

variable "tags" {
  description = "Tags applied to management group-level deployable resources"
  type        = map(string)
  default     = {}
}
