output "hub_vnet_id" {
  description = "Resource ID of the hub virtual network"
  value       = module.hub.hub_vnet_id
}

output "spoke_prod_vnet_id" {
  description = "Resource ID of the production spoke virtual network"
  value       = module.spoke_prod.spoke_vnet_id
}

output "spoke_staging_vnet_id" {
  description = "Resource ID of the staging spoke virtual network"
  value       = module.spoke_staging.spoke_vnet_id
}

output "hub_firewall_private_ip" {
  description = "Private IP of the hub Azure Firewall (use in spoke UDRs)"
  value       = module.hub.firewall_private_ip
}

output "hub_key_vault_uri" {
  description = "URI of the hub Key Vault"
  value       = module.hub.key_vault_uri
}

output "resource_group_name" {
  description = "Name of the main resource group"
  value       = azurerm_resource_group.main.name
}

output "acr_login_server" {
  description = "ACR login server URL (use as Docker registry)"
  value       = module.acr.login_server
}

output "acr_name" {
  description = "Name of the Azure Container Registry"
  value       = module.acr.acr_name
}

output "aks_cluster_name" {
  description = "Name of the AKS cluster"
  value       = module.aks.cluster_name
}

output "aks_cluster_id" {
  description = "Resource ID of the AKS cluster"
  value       = module.aks.cluster_id
}

output "kube_config_command" {
  description = "Azure CLI command to merge kubeconfig"
  value       = "az aks get-credentials --resource-group ${azurerm_resource_group.main.name} --name ${module.aks.cluster_name}"
}

output "app_insights_instrumentation_key" {
  description = "Application Insights instrumentation key (set in app env)"
  value       = module.monitoring.instrumentation_key
  sensitive   = true
}

output "app_insights_connection_string" {
  description = "Application Insights connection string"
  value       = module.monitoring.connection_string
  sensitive   = true
}

# ── Entra External ID (CIAM) ────────────────────────────────────────────────

output "ciam_tenant_id" {
  description = "Tenant ID of the CIAM directory (set as AZURE_TENANT_ID in backend env)"
  value       = module.entra_ciam.ciam_tenant_id
}

output "ciam_tenant_subdomain" {
  description = "CIAM subdomain (set as AZURE_TENANT_SUBDOMAIN / VITE_AZURE_TENANT_SUBDOMAIN)"
  value       = module.entra_ciam.ciam_tenant_subdomain
}

output "ciam_spa_client_id" {
  description = "SPA app client ID (set as AZURE_CLIENT_ID / VITE_AZURE_CLIENT_ID for auth)"
  value       = module.entra_ciam.spa_client_id
}
