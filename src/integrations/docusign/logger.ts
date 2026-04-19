import { ConnectorErrorType } from "./types";

interface DocuSignLogEvent {
  event: "connect" | "sync" | "error" | "disconnect" | "webhook" | "health";
  level: "info" | "warn" | "error";
  message: string;
  userId?: string;
  accountId?: string;
  connector: "docusign";
  errorType?: ConnectorErrorType;
  metadata?: Record<string, unknown>;
}

export function logDocuSign(event: DocuSignLogEvent): void {
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
