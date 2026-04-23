import { ConnectorErrorType } from "./types";

interface GmailLogEvent {
  event: "connect" | "sync" | "error" | "disconnect" | "webhook" | "health";
  level: "info" | "warn" | "error";
  message: string;
  userId?: string;
  emailAddress?: string;
  connector: "gmail";
  errorType?: ConnectorErrorType;
  metadata?: Record<string, unknown>;
}

export function logGmail(event: GmailLogEvent): void {
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
