output "client_id" {
  value       = azurerm_user_assigned_identity.backend.client_id
  description = "Client ID used by the production backend service account annotation"
}

output "principal_id" {
  value       = azurerm_user_assigned_identity.backend.principal_id
  description = "Principal ID granted Key Vault Secrets User on the production Key Vault"
}

output "name" {
  value       = azurerm_user_assigned_identity.backend.name
  description = "Managed identity name"
}
