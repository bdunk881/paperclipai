import { AgentCatalogProvider, ConnectorErrorType } from "./types";

interface AgentCatalogLogEvent {
  event: "connect" | "sync" | "error" | "disconnect" | "health";
  level: "info" | "warn" | "error";
  connector: "agent-catalog";
  userId: string;
  provider?: AgentCatalogProvider;
  message: string;
  errorType?: ConnectorErrorType;
  metadata?: Record<string, unknown>;
}

export function logAgentCatalog(event: AgentCatalogLogEvent): void {
  const serialized = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...event,
  });

  if (event.level === "error") {
    console.error(serialized);
    return;
  }
  if (event.level === "warn") {
    console.warn(serialized);
    return;
  }
  console.info(serialized);
}
