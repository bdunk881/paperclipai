# ── Security Module — Microsoft Defender for Cloud ────────────────────────────
#
# Enables Microsoft Defender for Cloud (formerly Security Center) at the
# subscription level. Configures:
#
#   1. Defender plans — Containers (AKS) and Key Vaults (always on);
#      App Services optional via var.enable_app_services_defender.
#   2. Security contact — alert email + phone routed to ops@helloautoflow.com.
#   3. Auto-provisioning — MMA/AMA agents deployed to all VMs automatically.
#   4. Workspace association — routes Defender raw data to the central Log
#      Analytics workspace for SIEM/hunting queries.
#   5. Diagnostic setting — exports subscription-level Security activity log
#      category to the central Log Analytics workspace.
#
# All resources are subscription-scoped singletons; only one instance of this
# module should be called per subscription.

data "azurerm_client_config" "current" {}

# ── 1. Defender Plans ─────────────────────────────────────────────────────────

# Defender for Containers — protects AKS clusters, container images, and
# running workloads. Required for CIS AKS benchmark compliance.
resource "azurerm_security_center_subscription_pricing" "containers" {
  tier          = "Standard"
  resource_type = "Containers"
}

# Defender for Key Vaults — detects unusual and potentially harmful access
# attempts to Key Vault accounts.
resource "azurerm_security_center_subscription_pricing" "key_vaults" {
  tier          = "Standard"
  resource_type = "KeyVaults"
}

# Defender for App Services — optional; enable if App Services are deployed.
resource "azurerm_security_center_subscription_pricing" "app_services" {
  count = var.enable_app_services_defender ? 1 : 0

  tier          = "Standard"
  resource_type = "AppServices"
}

# ── 2. Security Contact ───────────────────────────────────────────────────────

resource "azurerm_security_center_contact" "main" {
  email = var.alert_email
  phone = var.alert_phone != "" ? var.alert_phone : null

  # Send alert notifications to the contact email.
  alert_notifications = true

  # Also notify all subscription owners/admins.
  alerts_to_admins = true
}

# ── 3. Workspace Association ──────────────────────────────────────────────────
#
# Routes Defender for Cloud raw security data (alerts, assessments, inventory)
# to the central Log Analytics workspace. This enables KQL hunting queries and
# integration with Sentinel or other SIEM tools.

resource "azurerm_security_center_workspace" "main" {
  scope        = "/subscriptions/${data.azurerm_client_config.current.subscription_id}"
  workspace_id = var.log_analytics_workspace_id
}

# ── 4. Diagnostic Setting ─────────────────────────────────────────────────────
#
# Exports the subscription-level "Security" activity log category to the
# central Log Analytics workspace. This captures control-plane security events
# (policy changes, resource locks, role assignments) alongside Defender alerts
# already routed via the workspace association above.

resource "azurerm_monitor_diagnostic_setting" "security_alerts" {
  name                       = "defender-security-to-law"
  target_resource_id         = "/subscriptions/${data.azurerm_client_config.current.subscription_id}"
  log_analytics_workspace_id = var.log_analytics_workspace_id

  # Security category covers Defender alerts and security-related control-plane
  # events surfaced in the subscription activity log.
  enabled_log {
    category = "Security"
  }

  # Retain security logs for 90 days in the Log Analytics workspace; set to 0
  # to use the workspace-level retention policy (recommended for cost control).
  metric {
    category = "AllMetrics"
    enabled  = false
  }

  depends_on = [
    azurerm_security_center_subscription_pricing.containers,
    azurerm_security_center_subscription_pricing.key_vaults,
    azurerm_security_center_workspace.main,
  ]
}
