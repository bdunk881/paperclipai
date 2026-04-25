variable "prefix" {
  description = "Short project prefix used in resource names"
  type        = string
}

variable "environment" {
  description = "Deployment environment: staging or production"
  type        = string
}

variable "location" {
  description = "Azure region for the CIAM directory resource"
  type        = string
}

variable "resource_group_name" {
  description = "Name of the resource group that owns the CIAM directory billing link"
  type        = string
}

variable "ciam_tenant_subdomain" {
  description = "Subdomain for the CIAM tenant (e.g. 'autoflow' -> autoflow.ciamlogin.com). Must be globally unique."
  type        = string
}

variable "existing_ciam_tenant_id" {
  description = "Existing CIAM tenant ID to reuse instead of creating a new directory"
  type        = string
  default     = null
}

variable "ciam_display_name" {
  description = "Display name for the CIAM directory shown in Azure Portal"
  type        = string
  default     = ""
}

variable "spa_redirect_uris" {
  description = "Redirect URIs for the SPA app registration (must include /auth/callback and /login for all deployed hosts)"
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

variable "tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default     = {}
}
