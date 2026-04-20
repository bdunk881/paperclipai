output "subscription_id" {
  description = "The subscription ID on which Defender for Cloud is configured"
  value       = data.azurerm_client_config.current.subscription_id
}

output "security_contact_id" {
  description = "Resource ID of the Defender for Cloud security contact"
  value       = azurerm_security_center_contact.main.id
}

output "workspace_association_id" {
  description = "Resource ID of the Defender for Cloud workspace association (subscription → Log Analytics)"
  value       = azurerm_security_center_workspace.main.id
}

output "diagnostic_setting_id" {
  description = "Resource ID of the subscription-level security diagnostic setting"
  value       = azurerm_monitor_diagnostic_setting.security_alerts.id
}
