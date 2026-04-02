# AutoFlow Log Retention Policy

**Effective date:** 2026-04-02
**Control reference:** CIS Control #8 (Audit Log Management)

## Scope

This policy covers all application logs emitted by AutoFlow backend services running on AWS ECS/Fargate and ingested into Amazon CloudWatch Logs.

## Retention Requirements

| Log type | Minimum retention | CloudWatch log group |
|---|---|---|
| Application / security audit | **90 days** | `/ecs/autoflow-backend` (env-specific) |
| Infrastructure / ALB access | **90 days** | Managed by `aws_cloudwatch_log_group.app` |

The 90-day minimum satisfies CIS Control #8.2 (retain audit logs for a period appropriate to the risk) and provides sufficient lookback for incident investigation.

## Security Event Log Format

All security-relevant events are emitted as newline-delimited JSON to stdout by `src/auth/securityLogger.ts` and collected by the ECS log driver. Each entry has:

```json
{
  "timestamp": "<ISO-8601>",
  "event_type": "<see table below>",
  "ip": "<client IP>",
  "user_agent": "<string>",
  "path": "<request path>",
  "method": "<HTTP verb>",
  "<additional fields per event_type>"
}
```

### Event types

| `event_type` | Emitted when |
|---|---|
| `auth_failure` | JWT validation fails (missing header, expired token, misconfigured service) |
| `auth_success` | JWT validated successfully; includes `sub` (user ID) |
| `approval_resolved` | A HITL approval is approved or rejected; includes `approval_id`, `decision`, `resolved_by`, `run_id` |
| `llm_config_created` | A user adds a new LLM provider credential; includes `user_id`, `config_id`, `provider` |
| `llm_config_updated` | A user updates an LLM config label or model; includes `user_id`, `config_id`, `provider` |
| `llm_config_deleted` | A user deletes an LLM config; includes `user_id`, `config_id` |

## Alerting

A CloudWatch metric filter (`autoflow-{env}-auth-failure`) counts `auth_failure` events per minute.
An alarm (`autoflow-{env}-auth-failure-rate-high`) triggers when the count exceeds **10 per minute**, routing to PagerDuty via SNS for brute-force / credential-stuffing response.

## Infrastructure

Retention is enforced in Terraform via `aws_cloudwatch_log_group.app` in `infra/monitoring/cloudwatch-alarms.tf`.
The `app_log_group` variable must be set per environment in the corresponding Terraform workspace.
