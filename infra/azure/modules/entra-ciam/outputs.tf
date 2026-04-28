output "ciam_tenant_id" {
  description = "Tenant ID (GUID) of the provisioned CIAM directory"
  value       = var.existing_ciam_tenant_id
}

output "ciam_domain_name" {
  description = "Domain name of the CIAM directory"
  value       = "${var.ciam_tenant_subdomain}.onmicrosoft.com"
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

output "msa_federation_client_id" {
  description = "Application (client) ID of the Microsoft-account federation app registration"
  value       = azuread_application.autoflow_msa_federation.client_id
}

output "msa_federation_application_id" {
  description = "Object ID of the Microsoft-account federation app registration"
  value       = azuread_application.autoflow_msa_federation.id
}

output "msa_federation_client_secret" {
  description = "Client secret for the Microsoft-account federation app registration"
  value       = azuread_application_password.autoflow_msa_federation.value
  sensitive   = true
}

output "msa_federation_redirect_uris" {
  description = "Redirect URIs registered on the Microsoft-account federation app"
  value       = local.msa_federation_redirect_uris
}
