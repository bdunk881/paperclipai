output "storage_account_name" {
  description = "Name of the provisioned storage account"
  value       = azurerm_storage_account.this.name
}

output "storage_account_id" {
  description = "Resource ID of the storage account"
  value       = azurerm_storage_account.this.id
}

output "primary_blob_endpoint" {
  description = "Primary blob service endpoint URL"
  value       = azurerm_storage_account.this.primary_blob_endpoint
}

output "container_names" {
  description = "List of created container names"
  value       = [for c in azurerm_storage_container.this : c.name]
}
