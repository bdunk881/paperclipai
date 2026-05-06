variable "prefix" {
  description = "Short project prefix used in all resource names"
  type        = string
}

variable "environment" {
  description = "Deployment environment name"
  type        = string
}

variable "location" {
  description = "Azure region for the managed identity"
  type        = string
}

variable "resource_group_name" {
  description = "Resource group that owns the backend workload identity"
  type        = string
}

variable "oidc_issuer_url" {
  description = "AKS OIDC issuer URL used by the federated credential"
  type        = string
}

variable "namespace" {
  description = "Kubernetes namespace for the backend service account"
  type        = string
}

variable "service_account_name" {
  description = "Kubernetes service account name federated to the identity"
  type        = string
}

variable "tags" {
  description = "Tags applied to the managed identity"
  type        = map(string)
  default     = {}
}
