output "hub_vnet_id" {
  description = "Resource ID of the hub virtual network"
  value       = azurerm_virtual_network.hub.id
}

output "hub_vnet_name" {
  description = "Name of the hub virtual network"
  value       = azurerm_virtual_network.hub.name
}

output "firewall_private_ip" {
  description = "Private IP address of the Azure Firewall (null when firewall is disabled)"
  value       = try(azurerm_firewall.hub[0].ip_configuration[0].private_ip_address, null)
}

output "firewall_id" {
  description = "Resource ID of the Azure Firewall (null when firewall is disabled)"
  value       = try(azurerm_firewall.hub[0].id, null)
}

output "firewall_policy_id" {
  description = "Resource ID of the Firewall Policy (null when firewall is disabled)"
  value       = try(azurerm_firewall_policy.hub[0].id, null)
}

output "key_vault_id" {
  description = "Resource ID of the hub Key Vault"
  value       = azurerm_key_vault.hub.id
}

output "key_vault_uri" {
  description = "URI of the hub Key Vault"
  value       = azurerm_key_vault.hub.vault_uri
}

output "private_dns_zone_acr_id" {
  description = "Resource ID of the ACR private DNS zone"
  value       = azurerm_private_dns_zone.acr.id
}

output "private_dns_zone_keyvault_id" {
  description = "Resource ID of the Key Vault private DNS zone"
  value       = azurerm_private_dns_zone.keyvault.id
}

output "private_dns_zone_blob_id" {
  description = "Resource ID of the Blob Storage private DNS zone"
  value       = azurerm_private_dns_zone.blob.id
}

output "mgmt_subnet_id" {
  description = "Resource ID of the management subnet"
  value       = azurerm_subnet.mgmt.id
}
