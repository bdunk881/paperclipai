export type ConnectorHealthState =
  | "healthy"
  | "degraded"
  | "rate_limited"
  | "auth_failed"
  | "provider_error"
  | "disabled";

export interface ConnectorHealthTransition {
  at: string;
  from: ConnectorHealthState;
  to: ConnectorHealthState;
  reason: string;
}

export interface ConnectorHealthRecord {
  connectorKey: string;
  connectorName: string;
  state: ConnectorHealthState;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  successRate24h: number;
  authFailures15m: number;
  rateLimitEvents15m: number;
  transitions: ConnectorHealthTransition[];
  source: "mock";
}

const CONNECTOR_HEALTH: ConnectorHealthRecord[] = [
  {
    connectorKey: "slack",
    connectorName: "Slack",
    state: "healthy",
    lastSuccessAt: "2026-04-28T04:35:00.000Z",
    lastErrorAt: null,
    lastErrorMessage: null,
    successRate24h: 99.8,
    authFailures15m: 0,
    rateLimitEvents15m: 0,
    transitions: [
      {
        at: "2026-04-28T02:10:00.000Z",
        from: "degraded",
        to: "healthy",
        reason: "API latency recovered below threshold",
      },
    ],
    source: "mock",
  },
  {
    connectorKey: "hubspot",
    connectorName: "HubSpot",
    state: "degraded",
    lastSuccessAt: "2026-04-28T04:31:00.000Z",
    lastErrorAt: "2026-04-28T04:33:00.000Z",
    lastErrorMessage: "Elevated 5xx responses from provider API",
    successRate24h: 94.3,
    authFailures15m: 0,
    rateLimitEvents15m: 1,
    transitions: [
      {
        at: "2026-04-28T04:20:00.000Z",
        from: "healthy",
        to: "degraded",
        reason: "Connector-wide provider failures crossed threshold",
      },
    ],
    source: "mock",
  },
  {
    connectorKey: "stripe",
    connectorName: "Stripe",
    state: "healthy",
    lastSuccessAt: "2026-04-28T04:34:00.000Z",
    lastErrorAt: "2026-04-28T01:11:00.000Z",
    lastErrorMessage: "Transient timeout retried successfully",
    successRate24h: 99.5,
    authFailures15m: 0,
    rateLimitEvents15m: 0,
    transitions: [
      {
        at: "2026-04-28T01:13:00.000Z",
        from: "degraded",
        to: "healthy",
        reason: "Retry queue drained successfully",
      },
    ],
    source: "mock",
  },
  {
    connectorKey: "gmail",
    connectorName: "Gmail",
    state: "rate_limited",
    lastSuccessAt: "2026-04-28T04:32:00.000Z",
    lastErrorAt: "2026-04-28T04:34:00.000Z",
    lastErrorMessage: "429 rate limit window active for sync jobs",
    successRate24h: 92.9,
    authFailures15m: 0,
    rateLimitEvents15m: 8,
    transitions: [
      {
        at: "2026-04-28T04:28:00.000Z",
        from: "healthy",
        to: "rate_limited",
        reason: "Repeated provider throttling for mailbox sync",
      },
    ],
    source: "mock",
  },
  {
    connectorKey: "sentry",
    connectorName: "Sentry",
    state: "healthy",
    lastSuccessAt: "2026-04-28T04:30:00.000Z",
    lastErrorAt: null,
    lastErrorMessage: null,
    successRate24h: 99.9,
    authFailures15m: 0,
    rateLimitEvents15m: 0,
    transitions: [],
    source: "mock",
  },
  {
    connectorKey: "linear",
    connectorName: "Linear",
    state: "auth_failed",
    lastSuccessAt: "2026-04-28T03:58:00.000Z",
    lastErrorAt: "2026-04-28T04:34:00.000Z",
    lastErrorMessage: "OAuth refresh token rejected by provider",
    successRate24h: 88.1,
    authFailures15m: 6,
    rateLimitEvents15m: 0,
    transitions: [
      {
        at: "2026-04-28T04:18:00.000Z",
        from: "healthy",
        to: "auth_failed",
        reason: "Repeated token refresh failures exceeded policy",
      },
    ],
    source: "mock",
  },
  {
    connectorKey: "teams",
    connectorName: "Teams",
    state: "healthy",
    lastSuccessAt: "2026-04-28T04:35:00.000Z",
    lastErrorAt: "2026-04-27T22:42:00.000Z",
    lastErrorMessage: "Webhook delivery delay recovered",
    successRate24h: 98.7,
    authFailures15m: 0,
    rateLimitEvents15m: 0,
    transitions: [],
    source: "mock",
  },
  {
    connectorKey: "jira",
    connectorName: "Jira",
    state: "provider_error",
    lastSuccessAt: "2026-04-28T02:48:00.000Z",
    lastErrorAt: "2026-04-28T04:35:00.000Z",
    lastErrorMessage: "Connector worker has not completed a successful sync in 90 minutes",
    successRate24h: 76.4,
    authFailures15m: 0,
    rateLimitEvents15m: 0,
    transitions: [
      {
        at: "2026-04-28T03:52:00.000Z",
        from: "degraded",
        to: "provider_error",
        reason: "Extended outage threshold exceeded",
      },
    ],
    source: "mock",
  },
];

export function listConnectorHealth(): ConnectorHealthRecord[] {
  return CONNECTOR_HEALTH;
}

export function getConnectorHealthSummary(records = CONNECTOR_HEALTH) {
  const counts = {
    healthy: 0,
    degraded: 0,
    rate_limited: 0,
    auth_failed: 0,
    provider_error: 0,
    disabled: 0,
  };

  for (const record of records) {
    counts[record.state] += 1;
  }

  return {
    total: records.length,
    states: counts,
    lastUpdatedAt: new Date(
      Math.max(
        ...records.map((record) =>
          Date.parse(record.lastErrorAt ?? record.lastSuccessAt ?? "1970-01-01T00:00:00.000Z")
        )
      )
    ).toISOString(),
    alertPolicy: {
      degradedWithinMinutes: 5,
      authFailureThreshold15m: 5,
      rateLimitThreshold15m: 5,
      outageThresholdMinutes: 15,
    },
    source: "mock" as const,
  };
}
