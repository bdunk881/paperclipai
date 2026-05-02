import { apolloConnectorService } from "../integrations/apollo/service";
import { composioConnectorService } from "../integrations/composio/service";
import { gmailConnectorService } from "../integrations/gmail/service";
import { hubSpotConnectorService } from "../integrations/hubspot/service";
import { linearConnectorService } from "../integrations/linear/service";
import { sentryConnectorService } from "../integrations/sentry/service";
import { slackConnectorService } from "../integrations/slack/service";
import { stripeConnectorService } from "../integrations/stripe/service";
import { teamsConnectorService } from "../integrations/teams/service";

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
  source: "api";
}

type ConnectorHealthProbe = {
  key: string;
  name: string;
  probe: (userId: string) => Promise<unknown>;
};

const CONNECTOR_HEALTH_PROBES: ConnectorHealthProbe[] = [
  { key: "slack", name: "Slack", probe: (userId) => slackConnectorService.health(userId) },
  { key: "hubspot", name: "HubSpot", probe: (userId) => hubSpotConnectorService.health(userId) },
  { key: "stripe", name: "Stripe", probe: (userId) => stripeConnectorService.health(userId) },
  { key: "gmail", name: "Gmail", probe: (userId) => gmailConnectorService.health(userId) },
  { key: "sentry", name: "Sentry", probe: (userId) => sentryConnectorService.health(userId) },
  { key: "linear", name: "Linear", probe: (userId) => linearConnectorService.health(userId) },
  { key: "teams", name: "Teams", probe: (userId) => teamsConnectorService.health(userId) },
  { key: "apollo", name: "Apollo", probe: (userId) => apolloConnectorService.health(userId) },
  { key: "composio", name: "Composio", probe: (userId) => composioConnectorService.health(userId) },
];

export const CONNECTOR_HEALTH_KEYS = CONNECTOR_HEALTH_PROBES.map((probe) => probe.key);

type NormalizedConnectorHealth = {
  status: ConnectorHealthState;
  checkedAt: string;
  lastSuccessfulSyncAt?: string;
  details: {
    auth: boolean;
    apiReachable: boolean;
    rateLimited: boolean;
    errorType?: string;
    message?: string;
  };
};

function deriveSuccessRate(status: ConnectorHealthState): number {
  switch (status) {
    case "healthy":
      return 100;
    case "rate_limited":
      return 75;
    case "degraded":
      return 50;
    default:
      return 0;
  }
}

function mapHealthRecord(
  connector: ConnectorHealthProbe,
  health: NormalizedConnectorHealth,
): ConnectorHealthRecord {
  const lastSuccessAt =
    health.lastSuccessfulSyncAt ?? (health.status === "healthy" ? health.checkedAt : null);
  const lastErrorAt =
    health.status === "healthy" || health.status === "disabled" ? null : health.checkedAt;

  return {
    connectorKey: connector.key,
    connectorName: connector.name,
    state: health.status,
    lastSuccessAt,
    lastErrorAt,
    lastErrorMessage: health.details.message ?? null,
    successRate24h: deriveSuccessRate(health.status),
    authFailures15m: health.status === "auth_failed" ? 1 : 0,
    rateLimitEvents15m: health.status === "rate_limited" ? 1 : 0,
    transitions: [],
    source: "api",
  };
}

function normalizeHealth(input: unknown): NormalizedConnectorHealth {
  const health = input as {
    status?: string;
    checkedAt?: string;
    lastSuccessfulSyncAt?: string;
    details?: {
      auth?: boolean;
      apiReachable?: boolean;
      rateLimited?: boolean;
      errorType?: string;
      message?: string;
    };
  };
  const rawStatus = health.status;

  let status: ConnectorHealthState;
  switch (rawStatus) {
    case "healthy":
    case "degraded":
    case "rate_limited":
    case "auth_failed":
    case "provider_error":
    case "disabled":
      status = rawStatus;
      break;
    case "ok":
      status = "healthy";
      break;
    case "down":
      status = health.details?.errorType === "auth" ? "auth_failed" : "provider_error";
      break;
    default:
      status = health.details?.rateLimited ? "rate_limited" : "degraded";
      break;
  }

  return {
    status,
    checkedAt: health.checkedAt ?? new Date().toISOString(),
    lastSuccessfulSyncAt: health.lastSuccessfulSyncAt,
    details: {
      auth: Boolean(health.details?.auth),
      apiReachable: Boolean(health.details?.apiReachable),
      rateLimited: Boolean(health.details?.rateLimited),
      errorType: health.details?.errorType,
      message: health.details?.message,
    },
  };
}

export async function listConnectorHealth(userId: string): Promise<ConnectorHealthRecord[]> {
  const records = await Promise.all(
    CONNECTOR_HEALTH_PROBES.map(async (connector) => {
      try {
        return mapHealthRecord(connector, normalizeHealth(await connector.probe(userId)));
      } catch (error) {
        const checkedAt = new Date().toISOString();
        return {
          connectorKey: connector.key,
          connectorName: connector.name,
          state: "provider_error",
          lastSuccessAt: null,
          lastErrorAt: checkedAt,
          lastErrorMessage: error instanceof Error ? error.message : String(error),
          successRate24h: 0,
          authFailures15m: 0,
          rateLimitEvents15m: 0,
          transitions: [],
          source: "api",
        } satisfies ConnectorHealthRecord;
      }
    }),
  );

  return records.sort((left, right) => left.connectorName.localeCompare(right.connectorName));
}

export function getConnectorHealthSummary(records: ConnectorHealthRecord[]) {
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
          Date.parse(record.lastErrorAt ?? record.lastSuccessAt ?? "1970-01-01T00:00:00.000Z"),
        ),
      ),
    ).toISOString(),
    alertPolicy: {
      degradedWithinMinutes: 5,
      authFailureThreshold15m: 5,
      rateLimitThreshold15m: 5,
      outageThresholdMinutes: 15,
    },
    source: "api" as const,
  };
}
