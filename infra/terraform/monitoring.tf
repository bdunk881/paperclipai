# ─── Application Insights ─────────────────────────────────────────────────────
# Workspace-based Application Insights linked to the existing Log Analytics
# workspace so all telemetry lands in one queryable store.

resource "azurerm_application_insights" "main" {
  name                = "appi-${local.prefix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "web"
  tags                = local.tags
}

# Store the connection string in Key Vault so the app reads it at runtime
# via the managed identity — no secrets in container config at deploy time.
resource "azurerm_key_vault_secret" "appinsights_connection_string" {
  name         = "APPLICATIONINSIGHTS-CONNECTION-STRING"
  value        = azurerm_application_insights.main.connection_string
  key_vault_id = azurerm_key_vault.main.id

  depends_on = [azurerm_key_vault_access_policy.terraform_admin]
}

# ─── Alert Action Group ────────────────────────────────────────────────────────
# Receivers (email, webhook, PagerDuty, etc.) are wired here when ready.

resource "azurerm_monitor_action_group" "main" {
  name                = "ag-${local.prefix}-alerts"
  resource_group_name = azurerm_resource_group.main.name
  short_name          = "autoflow"
  tags                = local.tags
}

# ─── Alert: 5xx error rate > 1 % over 5 minutes ───────────────────────────────
# Data comes from App Insights request telemetry written to the shared
# Log Analytics workspace.

resource "azurerm_monitor_scheduled_query_rules_alert_v2" "error_rate" {
  name                = "alert-${local.prefix}-5xx-error-rate"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  description         = "5xx error rate exceeded 1% over a 5-minute window"

  evaluation_frequency = "PT5M"
  window_duration      = "PT5M"
  scopes               = [azurerm_log_analytics_workspace.main.id]
  severity             = 2
  enabled              = true

  criteria {
    query = <<-QUERY
      requests
      | where timestamp > ago(5m)
      | summarize
          total  = count(),
          failed = countif(toint(resultCode) >= 500)
      | where total > 0
      | project error_rate = todouble(failed) / todouble(total) * 100
      | where error_rate > 1
    QUERY
    time_aggregation_method = "Count"
    threshold               = 0
    operator                = "GreaterThan"
  }

  action {
    action_groups = [azurerm_monitor_action_group.main.id]
  }

  tags = local.tags
}

# ─── Alert: P99 response time > 3 s ──────────────────────────────────────────

resource "azurerm_monitor_scheduled_query_rules_alert_v2" "p99_latency" {
  name                = "alert-${local.prefix}-p99-latency"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  description         = "P99 response latency exceeded 3 000 ms over a 5-minute window"

  evaluation_frequency = "PT5M"
  window_duration      = "PT5M"
  scopes               = [azurerm_log_analytics_workspace.main.id]
  severity             = 2
  enabled              = true

  criteria {
    query = <<-QUERY
      requests
      | where timestamp > ago(5m)
      | summarize p99_ms = percentile(duration, 99)
      | where p99_ms > 3000
    QUERY
    time_aggregation_method = "Count"
    threshold               = 0
    operator                = "GreaterThan"
  }

  action {
    action_groups = [azurerm_monitor_action_group.main.id]
  }

  tags = local.tags
}

# ─── Alert: Container restart count > 2 in 10 minutes ────────────────────────
# Container Apps emits system lifecycle events to ContainerAppSystemLogs_CL.

resource "azurerm_monitor_scheduled_query_rules_alert_v2" "container_restarts" {
  name                = "alert-${local.prefix}-container-restarts"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  description         = "Backend container restarted more than 2 times in 10 minutes"

  evaluation_frequency = "PT5M"
  window_duration      = "PT10M"
  scopes               = [azurerm_log_analytics_workspace.main.id]
  severity             = 1
  enabled              = true

  criteria {
    query = <<-QUERY
      ContainerAppSystemLogs_CL
      | where TimeGenerated > ago(10m)
      | where ContainerAppName_s == "ca-${local.prefix}-backend"
      | where Reason_s in ("BackOff", "OOMKilled", "Restarting")
      | count
    QUERY
    time_aggregation_method = "Count"
    threshold               = 2
    operator                = "GreaterThan"
  }

  action {
    action_groups = [azurerm_monitor_action_group.main.id]
  }

  tags = local.tags
}

# ─── Application Insights Workbook ────────────────────────────────────────────
# A basic overview workbook: request volume, error rate, latency percentiles.
# Accessible in the Azure portal under Application Insights > Workbooks.

resource "random_uuid" "workbook" {}

resource "azurerm_application_insights_workbook" "main" {
  name                = random_uuid.workbook.result
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  display_name        = "AutoFlow ${title(var.environment)} Overview"
  source_id           = lower(azurerm_application_insights.main.id)
  tags                = local.tags

  data_json = jsonencode({
    version = "Notebook/1.0"
    items = [
      {
        type = 1
        name = "header"
        content = {
          json = "## AutoFlow ${title(var.environment)} — Overview\n\nRequest volume · error rate · latency percentiles · container utilization."
        }
      },
      {
        type = 3
        name = "request-volume"
        content = {
          version      = "KqlItem/1.0"
          title        = "Request Volume (last 1 h, 5-min buckets)"
          query        = "requests | where timestamp > ago(1h) | summarize count() by bin(timestamp, 5m) | render timechart"
          size         = 0
          queryType    = 0
          resourceType = "microsoft.insights/components"
          timeContext  = { durationMs = 3600000 }
        }
      },
      {
        type = 3
        name = "error-rate"
        content = {
          version      = "KqlItem/1.0"
          title        = "5xx Error Rate % (last 1 h)"
          query        = "requests | where timestamp > ago(1h) | summarize error_rate = 100.0 * countif(toint(resultCode) >= 500) / count() by bin(timestamp, 5m) | render timechart"
          size         = 0
          queryType    = 0
          resourceType = "microsoft.insights/components"
          timeContext  = { durationMs = 3600000 }
        }
      },
      {
        type = 3
        name = "latency-percentiles"
        content = {
          version      = "KqlItem/1.0"
          title        = "Latency Percentiles ms (last 1 h)"
          query        = "requests | where timestamp > ago(1h) | summarize p50 = percentile(duration, 50), p95 = percentile(duration, 95), p99 = percentile(duration, 99) by bin(timestamp, 5m) | render timechart"
          size         = 0
          queryType    = 0
          resourceType = "microsoft.insights/components"
          timeContext  = { durationMs = 3600000 }
        }
      },
      {
        type = 3
        name = "exceptions"
        content = {
          version      = "KqlItem/1.0"
          title        = "Unhandled Exceptions (last 1 h)"
          query        = "exceptions | where timestamp > ago(1h) | summarize count() by bin(timestamp, 5m), type | render timechart"
          size         = 0
          queryType    = 0
          resourceType = "microsoft.insights/components"
          timeContext  = { durationMs = 3600000 }
        }
      }
    ]
  })
}
