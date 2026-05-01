resource "azurerm_application_insights" "main" {
  name                = "${var.prefix}-${var.environment}-appinsights"
  location            = var.location
  resource_group_name = var.resource_group_name
  # Reuse the Log Analytics workspace created by the AKS module so all logs
  # (container insights + app traces) land in a single workspace.
  workspace_id     = var.log_analytics_workspace_id
  application_type = "web"

  tags = var.tags
}

# ── Action group for alerts (email) ──────────────────────────────────────────

resource "azurerm_monitor_action_group" "oncall" {
  name                = "${var.prefix}-${var.environment}-oncall"
  resource_group_name = var.resource_group_name
  short_name          = "oncall"

  email_receiver {
    name          = "oncall-email"
    email_address = var.alert_email
  }

  tags = var.tags
}

# ── AKS node CPU alert ────────────────────────────────────────────────────────

resource "azurerm_monitor_metric_alert" "aks_cpu" {
  name                = "${var.prefix}-${var.environment}-aks-cpu-high"
  resource_group_name = var.resource_group_name
  scopes              = [var.aks_cluster_id]
  description         = "AKS node CPU usage above 80% for 5 minutes"
  severity            = 2
  frequency           = "PT1M"
  window_size         = "PT5M"

  criteria {
    metric_namespace = "Microsoft.ContainerService/managedClusters"
    metric_name      = "node_cpu_usage_percentage"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }

  action {
    action_group_id = azurerm_monitor_action_group.oncall.id
  }

  tags = var.tags
}

# ── AKS node memory alert ─────────────────────────────────────────────────────

resource "azurerm_monitor_metric_alert" "aks_memory" {
  name                = "${var.prefix}-${var.environment}-aks-memory-high"
  resource_group_name = var.resource_group_name
  scopes              = [var.aks_cluster_id]
  description         = "AKS node memory usage above 85% for 5 minutes"
  severity            = 2
  frequency           = "PT1M"
  window_size         = "PT5M"

  criteria {
    metric_namespace = "Microsoft.ContainerService/managedClusters"
    metric_name      = "node_memory_working_set_percentage"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 85
  }

  action {
    action_group_id = azurerm_monitor_action_group.oncall.id
  }

  tags = var.tags
}

# ── Application Insights availability test ────────────────────────────────────

resource "azurerm_application_insights_web_test" "health" {
  name                    = "${var.prefix}-${var.environment}-health-ping"
  location                = var.location
  resource_group_name     = var.resource_group_name
  application_insights_id = azurerm_application_insights.main.id
  kind                    = "ping"
  frequency               = 300
  timeout                 = 30
  enabled                 = true
  geo_locations           = ["us-va-ash-azr", "us-ca-sjc-azr", "us-tx-sn1-azr"]

  configuration = <<XML
<WebTest Name="health-check" Enabled="True" Timeout="30" xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
  <Items>
    <Request Method="GET" Url="https://${var.app_hostname}/health" Version="1.1" FollowRedirects="true" RecordResult="true" Cache="false" ResponseTimeGoal="0" Encoding="utf-8" ExpectedHttpStatusCode="200" IgnoreHttpStatusCode="false" />
  </Items>
</WebTest>
XML

  tags = merge(var.tags, {
    "hidden-link:${azurerm_application_insights.main.id}" = "Resource"
  })
}
