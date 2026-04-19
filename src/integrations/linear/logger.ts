import { ConnectorErrorType } from "./types";

interface LinearLogEvent {
  event: "connect" | "sync" | "error" | "disconnect" | "webhook" | "health";
  level: "info" | "warn" | "error";
  message: string;
  userId?: string;
  organizationId?: string;
  connector: "linear";
  errorType?: ConnectorErrorType;
  metadata?: Record<string, unknown>;
}

export function logLinear(event: LinearLogEvent): void {
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
