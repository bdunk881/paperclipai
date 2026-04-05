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

variable "ciam_display_name" {
  description = "Display name for the CIAM directory shown in Azure Portal"
  type        = string
  default     = ""
}

variable "spa_redirect_uris" {
  description = "Redirect URIs for the SPA app registration (localhost for dev, Vercel URL for prod)"
  type        = list(string)
  default     = ["http://localhost:5173"]
}

variable "spa_logout_uris" {
  description = "Post-logout redirect URIs for the SPA"
  type        = list(string)
  default     = ["http://localhost:5173/login"]
}

variable "tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default     = {}
}
