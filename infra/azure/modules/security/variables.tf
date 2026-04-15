variable "log_analytics_workspace_id" {
  description = "Resource ID of the central Log Analytics workspace — Defender data and security alert diagnostic logs are exported here"
  type        = string
}

variable "alert_email" {
  description = "Email address for Microsoft Defender for Cloud security alerts"
  type        = string
}

variable "alert_phone" {
  description = "Phone number for Microsoft Defender for Cloud security alerts (optional)"
  type        = string
  default     = ""
}

variable "enable_app_services_defender" {
  description = "Whether to enable Defender for App Services (set to false if App Services are not in scope)"
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags propagated to diagnostic setting resources"
  type        = map(string)
  default     = {}
}
