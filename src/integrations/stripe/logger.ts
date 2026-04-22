import { ConnectorErrorType } from "./types";

interface StripeLogEvent {
  event: "connect" | "sync" | "error" | "disconnect" | "webhook" | "health";
  level: "info" | "warn" | "error";
  message: string;
  userId?: string;
  accountId?: string;
  connector: "stripe";
  errorType?: ConnectorErrorType;
  metadata?: Record<string, unknown>;
}

export function logStripe(event: StripeLogEvent): void {
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
