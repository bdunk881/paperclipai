output "resource_group_name" {
  description = "Name of the provisioned resource group"
  value       = azurerm_resource_group.main.name
}

output "container_app_fqdn" {
  description = "Fully-qualified domain name for the backend Container App"
  value       = azurerm_container_app.backend.ingress[0].fqdn
}

output "storage_account_name" {
  description = "Storage account name (set as AZURE_STORAGE_ACCOUNT_NAME in the app)"
  value       = azurerm_storage_account.main.name
}

output "key_vault_name" {
  description = "Key Vault name"
  value       = azurerm_key_vault.main.name
}

output "key_vault_uri" {
  description = "Key Vault URI"
  value       = azurerm_key_vault.main.vault_uri
}

output "postgres_fqdn" {
  description = "PostgreSQL Flexible Server FQDN"
  value       = azurerm_postgresql_flexible_server.main.fqdn
}

output "redis_hostname" {
  description = "Redis Cache hostname"
  value       = azurerm_redis_cache.main.hostname
}

output "app_managed_identity_client_id" {
  description = "Client ID of the user-assigned managed identity attached to Container Apps"
  value       = azurerm_user_assigned_identity.app.client_id
}

output "github_actions_client_id" {
  description = "Client ID of the GitHub Actions service principal (set as AZURE_CLIENT_ID in Actions OIDC)"
  value       = azuread_application.github_actions.client_id
}

output "tenant_id" {
  description = "Azure tenant ID (set as AZURE_TENANT_ID in Actions OIDC)"
  value       = data.azurerm_client_config.current.tenant_id
}

output "subscription_id" {
  description = "Azure subscription ID (set as AZURE_SUBSCRIPTION_ID in Actions OIDC)"
  value       = data.azurerm_subscription.current.subscription_id
}

output "migration_job_name" {
  description = "Name of the Container App Job that runs Alembic migrations pre-deploy"
  value       = azurerm_container_app_job.migration.name
}
