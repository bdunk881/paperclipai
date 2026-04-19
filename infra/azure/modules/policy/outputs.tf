output "initiative_id" {
  description = "Resource ID of the autoflow-baseline policy initiative (policy set definition)"
  value       = azurerm_policy_set_definition.autoflow_baseline.id
}

output "baseline_assignment_id" {
  description = "Resource ID of the autoflow-baseline initiative assignment"
  value       = azurerm_management_group_policy_assignment.baseline.id
}

output "defender_assignment_id" {
  description = "Resource ID of the Defender for Containers policy assignment"
  value       = azurerm_management_group_policy_assignment.defender_containers.id
}

output "diag_assignment_id" {
  description = "Resource ID of the diagnostic settings (Activity Log → LAW) policy assignment"
  value       = azurerm_management_group_policy_assignment.diag_activity_log.id
}

output "diag_assignment_principal_id" {
  description = "Object ID of the managed identity attached to the diagnostic settings DINE assignment (used to grant Monitoring Contributor at subscription scope for remediation)"
  value       = azurerm_management_group_policy_assignment.diag_activity_log.identity[0].principal_id
}

output "defender_assignment_principal_id" {
  description = "Object ID of the managed identity attached to the Defender for Containers DINE assignment (used to grant Security Admin at management group scope for remediation)"
  value       = azurerm_management_group_policy_assignment.defender_containers.identity[0].principal_id
}
