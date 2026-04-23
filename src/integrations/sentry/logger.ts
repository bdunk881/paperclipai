import { ConnectorErrorType } from "./types";

interface SentryLogEvent {
  event: "connect" | "sync" | "error" | "disconnect" | "webhook" | "health";
  level: "info" | "warn" | "error";
  message: string;
  userId?: string;
  organizationId?: string;
  organizationSlug?: string;
  connector: "sentry";
  errorType?: ConnectorErrorType;
  metadata?: Record<string, unknown>;
}

export function logSentry(event: SentryLogEvent): void {
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
