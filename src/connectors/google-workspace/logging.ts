export type ConnectorErrorCategory = "auth" | "rate-limit" | "schema" | "network" | "upstream";

interface LogEvent {
  connector: "google_workspace";
  event: string;
  userId?: string;
  credentialId?: string;
  category?: ConnectorErrorCategory;
  message?: string;
  detail?: Record<string, unknown>;
}

export function logGoogleWorkspaceEvent(event: LogEvent): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level: event.category ? "error" : "info",
    ...event,
  };
  console.info(JSON.stringify(payload));
}
