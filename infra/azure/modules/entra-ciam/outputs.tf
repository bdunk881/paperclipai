output "ciam_tenant_id" {
  description = "Tenant ID (GUID) of the provisioned CIAM directory"
  value       = var.existing_ciam_tenant_id != null ? var.existing_ciam_tenant_id : azurerm_aadb2c_directory.ciam[0].tenant_id
}

output "ciam_domain_name" {
  description = "Domain name of the CIAM directory"
  value       = local.ciam_domain_name
}

output "ciam_tenant_subdomain" {
  description = "Subdomain for ciamlogin.com authority URL"
  value       = var.ciam_tenant_subdomain
}

output "spa_client_id" {
  description = "Application (client) ID of the registered SPA"
  value       = azuread_application.autoflow_spa.client_id
}

output "spa_application_id" {
  description = "Object ID of the registered SPA application"
  value       = azuread_application.autoflow_spa.id
}
