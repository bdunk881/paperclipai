import { ConnectorErrorType, MonitoringProvider } from "./types";

interface MonitoringLogEvent {
  event: "connect" | "sync" | "error" | "disconnect" | "webhook" | "health";
  level: "info" | "warn" | "error";
  message: string;
  connector: "datadog-azure-monitor";
  provider?: MonitoringProvider;
  userId?: string;
  accountId?: string;
  errorType?: ConnectorErrorType;
  metadata?: Record<string, unknown>;
}

export function logMonitoring(event: MonitoringLogEvent): void {
  const payload = {
    ts: new Date().toISOString(),
    ...event,
  };

  const serialized = JSON.stringify(payload);
  if (event.level === "error") {
    console.error(serialized);
    return;
  }
  if (event.level === "warn") {
    console.warn(serialized);
    return;
  }
  console.log(serialized);
}
