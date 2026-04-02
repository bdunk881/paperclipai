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
