import { ConnectorErrorType } from "./types";

interface ApolloLogEvent {
  event: "connect" | "sync" | "error" | "disconnect" | "health";
  level: "info" | "warn" | "error";
  message: string;
  userId?: string;
  accountId?: string;
  connector: "apollo";
  errorType?: ConnectorErrorType;
  metadata?: Record<string, unknown>;
}

export function logApollo(event: ApolloLogEvent): void {
  const payload = JSON.stringify({
    ts: new Date().toISOString(),
    ...event,
  });

  if (event.level === "error") {
    console.error(payload);
    return;
  }
  if (event.level === "warn") {
    console.warn(payload);
    return;
  }
  console.log(payload);
}
