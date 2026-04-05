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
