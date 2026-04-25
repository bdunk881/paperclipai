output "autoflow_mg_id" {
  description = "Resource ID of the top-level autoflow management group"
  value       = local.autoflow_mg_id
}

output "platform_mg_id" {
  description = "Resource ID of the Platform management group"
  value       = azurerm_management_group.platform.id
}

output "connectivity_mg_id" {
  description = "Resource ID of the Connectivity management group"
  value       = azurerm_management_group.connectivity.id
}

output "identity_mg_id" {
  description = "Resource ID of the Identity management group"
  value       = azurerm_management_group.identity.id
}

output "management_mg_id" {
  description = "Resource ID of the Management management group"
  value       = azurerm_management_group.management.id
}

output "landing_zones_mg_id" {
  description = "Resource ID of the Landing Zones management group"
  value       = azurerm_management_group.landing_zones.id
}

output "lz_production_mg_id" {
  description = "Resource ID of the Production landing zone management group"
  value       = azurerm_management_group.lz_production.id
}

output "lz_development_mg_id" {
  description = "Resource ID of the Development landing zone management group"
  value       = azurerm_management_group.lz_development.id
}
