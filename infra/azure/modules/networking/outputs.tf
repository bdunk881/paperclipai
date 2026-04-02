output "vnet_id" { value = azurerm_virtual_network.main.id }
output "aks_subnet_id" { value = azurerm_subnet.aks.id }
output "pe_subnet_id" { value = azurerm_subnet.private_endpoints.id }
output "acr_private_dns_zone_id" { value = azurerm_private_dns_zone.acr.id }
