output "spoke_vnet_id" {
  description = "Resource ID of the spoke virtual network"
  value       = azurerm_virtual_network.spoke.id
}

output "spoke_vnet_name" {
  description = "Name of the spoke virtual network"
  value       = azurerm_virtual_network.spoke.name
}

output "aks_subnet_id" {
  description = "Resource ID of the AKS node subnet"
  value       = azurerm_subnet.aks.id
}

output "pe_subnet_id" {
  description = "Resource ID of the private endpoints subnet"
  value       = azurerm_subnet.pe.id
}

output "svc_subnet_id" {
  description = "Resource ID of the services subnet"
  value       = azurerm_subnet.svc.id
}

output "func_subnet_id" {
  description = "Resource ID of the functions / app-services subnet"
  value       = azurerm_subnet.func.id
}

output "aks_route_table_id" {
  description = "Resource ID of the route table associated with the AKS subnet"
  value       = azurerm_route_table.aks.id
}

output "pe_route_table_id" {
  description = "Resource ID of the route table associated with the private endpoints subnet"
  value       = azurerm_route_table.pe.id
}

output "svc_route_table_id" {
  description = "Resource ID of the route table associated with the services subnet"
  value       = azurerm_route_table.svc.id
}

output "func_route_table_id" {
  description = "Resource ID of the route table associated with the functions subnet"
  value       = azurerm_route_table.func.id
}

output "key_vault_id" {
  description = "Resource ID of the spoke Key Vault"
  value       = azurerm_key_vault.spoke.id
}

output "key_vault_uri" {
  description = "URI of the spoke Key Vault"
  value       = azurerm_key_vault.spoke.vault_uri
}
