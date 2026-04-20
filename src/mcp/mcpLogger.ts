type McpLogEvent =
  | "server_registered"
  | "server_removed"
  | "health_checked"
  | "tools_discovered"
  | "rpc_error";

export function logMcpEvent(
  event: McpLogEvent,
  fields: Record<string, unknown>
): void {
  console.info(
    JSON.stringify({
      scope: "mcp",
      event,
      timestamp: new Date().toISOString(),
      ...fields,
    })
  );
}
