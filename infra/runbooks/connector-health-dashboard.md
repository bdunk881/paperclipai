# Connector Health Dashboard & Alerting

This runbook covers the scaffolded connector health dashboard and the alerting infrastructure defined in `infra/azure/connector-health-monitoring/main.bicep`.

## Current state

- Dashboard route: `dashboard/src/pages/ConnectorHealth.tsx`
- Backend API contract: `GET /api/connectors/health`
- IaC scaffold: `infra/azure/connector-health-monitoring/main.bicep`
- Data source today: mock telemetry only
- Blocked live integration: [ALT-1945](/ALT/issues/ALT-1945)

## Health model contract

Each connector record exposes:

- `connectorKey`
- `connectorName`
- `state`
- `lastSuccessAt`
- `lastErrorAt`
- `lastErrorMessage`
- `successRate24h`
- `authFailures15m`
- `rateLimitEvents15m`
- `transitions[]`

The dashboard assumes Tier 1 connectors emit one normalized record per health transition or evaluation interval.

## Alert policies

- Connector-wide degradation: any connector in `degraded` or `down` state during a 5 minute window
- Repeated auth failures: `>= 5` auth failures in 15 minutes for a connector
- Extended rate limiting: `>= 5` rate-limit events in 15 minutes for a connector

## Deploying the alert scaffold

1. Confirm the target Log Analytics workspace is receiving connector telemetry in a `ConnectorHealth_CL` table.
2. Deploy the Bicep template:

```bash
az deployment group create \
  --resource-group <rg> \
  --template-file infra/azure/connector-health-monitoring/main.bicep \
  --parameters environment=<env> \
               logAnalyticsWorkspaceResourceId=<workspace-resource-id> \
               alertEmail=<ops-email>
```

3. Validate the action group and three scheduled query alerts exist.
4. Trigger a synthetic degraded event and confirm an alert fires inside five minutes.

## Wiring live data after ALT-1945

1. Replace the mock implementation in `src/connectors/health.ts` with a store backed by emitted connector health records.
2. Ensure the backend endpoint returns live timestamps and transition history.
3. Align the connector emitter schema with `ConnectorHealth_CL` columns used by the Bicep queries.
4. Remove any dashboard copy that references mock telemetry.
