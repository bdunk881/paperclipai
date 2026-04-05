variable "management_group_id" {
  description = "Resource ID of the top-level autoflow management group (scope for all policy assignments)"
  type        = string
}

variable "log_analytics_workspace_id" {
  description = "Resource ID of the central Log Analytics workspace (used for diagnostic settings DINE policy)"
  type        = string
}

variable "location" {
  description = "Azure region — required for DINE policy assignment managed identity"
  type        = string
  default     = "eastus2"
}

variable "allowed_locations" {
  description = "List of Azure regions where resource deployments are permitted"
  type        = list(string)
  default     = ["eastus2"]
}

variable "tags" {
  description = "Tags to apply to policy assignment metadata"
  type        = map(string)
  default     = {}
}
