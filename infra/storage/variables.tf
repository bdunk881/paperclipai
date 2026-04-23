variable "resource_group_name" {
  description = "Name of the Azure resource group"
  type        = string
}

variable "location" {
  description = "Azure region for the storage account"
  type        = string
  default     = "eastus2"
}

variable "storage_account_name" {
  description = "Name of the storage account (must be globally unique, lowercase alphanumeric, 3-24 chars)"
  type        = string
  default     = "altitudemediastorage"
}

variable "cool_tier_days" {
  description = "Days before auto-tiering blobs to Cool storage"
  type        = number
  default     = 30
}

variable "archive_tier_days" {
  description = "Days before auto-tiering blobs to Archive storage"
  type        = number
  default     = 90
}

variable "managed_identity_principal_ids" {
  description = "List of Managed Identity principal IDs to grant Storage Blob Data Contributor access"
  type        = list(string)
  default     = []
}
