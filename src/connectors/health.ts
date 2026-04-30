import { integrationCredentialStore } from "../integrations/integrationCredentialStore";
import { INTEGRATION_CATALOG, getIntegrationBySlug } from "../integrations/integrationCatalog";

export type ConnectorHealthState =
  | "healthy"
  | "degraded"
  | "rate_limited"
  | "auth_failure"
  | "down";

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

export interface ConnectorHealthSummary {
  total: number;
  states: Record<ConnectorHealthState, number>;
  lastUpdatedAt: string | null;
  alertPolicy: {
    degradedWithinMinutes: number;
    authFailureThreshold15m: number;
    rateLimitThreshold15m: number;
    outageThresholdMinutes: number;
  };
  source: "api";
}

const DEFAULT_ALERT_POLICY = {
  degradedWithinMinutes: 5,
  authFailureThreshold15m: 5,
  rateLimitThreshold15m: 5,
  outageThresholdMinutes: 15,
} as const;

function preferredConnectionUpdatedAt(connections: Array<{ isDefault: boolean; updatedAt: string }>): string | null {
  const preferred = connections
    .slice()
    .sort((left, right) => {
      if (left.isDefault !== right.isDefault) {
        return Number(right.isDefault) - Number(left.isDefault);
      }
      return right.updatedAt.localeCompare(left.updatedAt);
    })[0];

  return preferred?.updatedAt ?? null;
}

export function listConnectorHealth(userId: string): ConnectorHealthRecord[] {
  const grouped = new Map<string, ReturnType<typeof integrationCredentialStore.list>>();
  for (const connection of integrationCredentialStore.list(userId)) {
    const current = grouped.get(connection.integrationSlug) ?? [];
    current.push(connection);
    grouped.set(connection.integrationSlug, current);
  }

  return Array.from(grouped.entries())
    .map(([integrationSlug, connections]) => {
      const manifest = getIntegrationBySlug(integrationSlug);
      const lastSuccessAt = preferredConnectionUpdatedAt(connections);
      return {
        connectorKey: integrationSlug,
        connectorName: manifest?.name ?? integrationSlug,
        state: "healthy" as const,
        lastSuccessAt,
        lastErrorAt: null,
        lastErrorMessage: null,
        successRate24h: 100,
        authFailures15m: 0,
        rateLimitEvents15m: 0,
        transitions: [],
        source: "api" as const,
      };
    })
    .sort((left, right) => left.connectorName.localeCompare(right.connectorName));
}

export function getConnectorHealthSummary(records: ConnectorHealthRecord[]): ConnectorHealthSummary {
  const states: Record<ConnectorHealthState, number> = {
    healthy: 0,
    degraded: 0,
    rate_limited: 0,
    auth_failure: 0,
    down: 0,
  };

  for (const record of records) {
    states[record.state] += 1;
  }

  const lastUpdatedAt = records.reduce<string | null>((latest, record) => {
    const candidate = record.lastErrorAt ?? record.lastSuccessAt;
    if (!candidate) {
      return latest;
    }
    if (!latest || candidate > latest) {
      return candidate;
    }
    return latest;
  }, null);

  return {
    total: records.length,
    states,
    lastUpdatedAt,
    alertPolicy: { ...DEFAULT_ALERT_POLICY },
    source: "api",
  };
}

export function listMonitorableConnectorSlugs(): string[] {
  return INTEGRATION_CATALOG.map((manifest) => manifest.slug).sort((left, right) => left.localeCompare(right));
}
