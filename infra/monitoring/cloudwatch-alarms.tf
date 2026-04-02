variable "env"                   { type = string }
variable "cluster_name"          { type = string }
variable "backend_service_name"  { type = string }
variable "alb_arn_suffix"        { type = string }
variable "backend_tg_arn_suffix" { type = string }
variable "pagerduty_webhook_url" {
  type      = string
  sensitive = true
}
variable "app_log_group" {
  type        = string
  description = "Name of the application CloudWatch log group (e.g. /ecs/autoflow-backend)"
}

locals {
  alarm_prefix = "autoflow-${var.env}"
}

# SNS topic → PagerDuty
resource "aws_sns_topic" "alerts" {
  name = "${local.alarm_prefix}-alerts"
}

resource "aws_sns_topic_subscription" "pagerduty" {
  topic_arn              = aws_sns_topic.alerts.arn
  protocol               = "https"
  endpoint               = var.pagerduty_webhook_url
  endpoint_auto_confirms = true
}

# High backend error rate (5xx > 5%)
resource "aws_cloudwatch_metric_alarm" "backend_5xx" {
  alarm_name          = "${local.alarm_prefix}-backend-5xx-high"
  alarm_description   = "Backend 5xx error rate > 5% for 5 minutes"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = 5
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  metric_query {
    id          = "error_rate"
    expression  = "errors / requests * 100"
    label       = "5xx Error Rate %"
    return_data = true
  }
  metric_query {
    id = "errors"
    metric {
      metric_name = "HTTPCode_Target_5XX_Count"
      namespace   = "AWS/ApplicationELB"
      period      = 60
      stat        = "Sum"
      dimensions = {
        LoadBalancer = var.alb_arn_suffix
        TargetGroup  = var.backend_tg_arn_suffix
      }
    }
  }
  metric_query {
    id = "requests"
    metric {
      metric_name = "RequestCount"
      namespace   = "AWS/ApplicationELB"
      period      = 60
      stat        = "Sum"
      dimensions = {
        LoadBalancer = var.alb_arn_suffix
        TargetGroup  = var.backend_tg_arn_suffix
      }
    }
  }
}

# High P99 latency
resource "aws_cloudwatch_metric_alarm" "backend_latency_p99" {
  alarm_name          = "${local.alarm_prefix}-backend-latency-p99"
  alarm_description   = "Backend P99 response time > 2s"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "p99"
  threshold           = 2
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
    TargetGroup  = var.backend_tg_arn_suffix
  }
}

# ECS CPU high
resource "aws_cloudwatch_metric_alarm" "backend_cpu" {
  alarm_name          = "${local.alarm_prefix}-backend-cpu-high"
  alarm_description   = "Backend ECS CPU > 85% — may need scale-out"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 60
  statistic           = "Average"
  threshold           = 85
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = var.cluster_name
    ServiceName = var.backend_service_name
  }
}

# Unhealthy host count
resource "aws_cloudwatch_metric_alarm" "backend_unhealthy_hosts" {
  alarm_name          = "${local.alarm_prefix}-backend-unhealthy-hosts"
  alarm_description   = "One or more backend hosts are unhealthy"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
    TargetGroup  = var.backend_tg_arn_suffix
  }
}

# CloudWatch Dashboard
resource "aws_cloudwatch_dashboard" "autoflow" {
  dashboard_name = "autoflow-${var.env}"

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric"
        properties = {
          title  = "Request Rate & Errors"
          period = 60
          stat   = "Sum"
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", var.alb_arn_suffix],
            ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", var.alb_arn_suffix],
            ["AWS/ApplicationELB", "HTTPCode_Target_4XX_Count", "LoadBalancer", var.alb_arn_suffix]
          ]
        }
      },
      {
        type = "metric"
        properties = {
          title  = "Response Latency (P50 / P99)"
          period = 60
          metrics = [
            ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", var.alb_arn_suffix, { stat = "p50" }],
            ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", var.alb_arn_suffix, { stat = "p99" }]
          ]
        }
      },
      {
        type = "metric"
        properties = {
          title  = "ECS CPU & Memory"
          period = 60
          stat   = "Average"
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", var.cluster_name, "ServiceName", var.backend_service_name],
            ["AWS/ECS", "MemoryUtilization", "ClusterName", var.cluster_name, "ServiceName", var.backend_service_name]
          ]
        }
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# Security audit logging — CIS Control #8
# ---------------------------------------------------------------------------

# Enforce 90-day minimum retention on the application log group.
# The log group is created by ECS/Fargate at first run; this resource
# adopts it and sets retention without re-creating it.
resource "aws_cloudwatch_log_group" "app" {
  name              = var.app_log_group
  retention_in_days = 90
}

# Metric filter — count structured auth_failure events emitted by the backend.
# Pattern matches the event_type field written by securityLogger.ts.
resource "aws_cloudwatch_log_metric_filter" "auth_failure" {
  name           = "${local.alarm_prefix}-auth-failure"
  log_group_name = aws_cloudwatch_log_group.app.name
  pattern        = "{ $.event_type = \"auth_failure\" }"

  metric_transformation {
    name          = "AuthFailureCount"
    namespace     = "AutoFlow/${var.env}"
    value         = "1"
    default_value = "0"
  }
}

# Alarm — brute-force / credential-stuffing detection (CIS #8).
# Fires when auth failures exceed 10 in a single 60-second window.
resource "aws_cloudwatch_metric_alarm" "auth_failure_rate" {
  alarm_name          = "${local.alarm_prefix}-auth-failure-rate-high"
  alarm_description   = "Auth failure rate > 10/min — possible brute-force or credential-stuffing attack"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "AuthFailureCount"
  namespace           = "AutoFlow/${var.env}"
  period              = 60
  statistic           = "Sum"
  threshold           = 10
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}
