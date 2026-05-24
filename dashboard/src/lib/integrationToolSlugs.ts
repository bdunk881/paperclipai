/** Connector keys exposed by GET /api/connectors/health */
export const KNOWN_CONNECTOR_KEYS = new Set([
  "slack",
  "hubspot",
  "stripe",
  "gmail",
  "sentry",
  "linear",
  "teams",
  "apollo",
  "composio",
]);

const TOOL_SLUG_TO_CONNECTOR_KEY: Record<string, string> = {
  slack: "slack",
  hubspot: "hubspot",
  stripe: "stripe",
  gmail: "gmail",
  "google-mail": "gmail",
  sentry: "sentry",
  linear: "linear",
  teams: "teams",
  "microsoft-teams": "teams",
  apollo: "apollo",
  composio: "composio",
  attio: "apollo",
};

export function resolveConnectorKeyForToolSlug(toolSlug: string): string | null {
  const normalized = toolSlug.trim().toLowerCase();
  if (KNOWN_CONNECTOR_KEYS.has(normalized)) {
    return normalized;
  }
  return TOOL_SLUG_TO_CONNECTOR_KEY[normalized] ?? null;
}

export function isToolSlugInCatalog(toolSlug: string): boolean {
  return resolveConnectorKeyForToolSlug(toolSlug) !== null;
}
