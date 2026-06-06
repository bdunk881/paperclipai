import { CONNECTOR_HEALTH_KEYS } from "../connectors/health";

/** LLM tool slugs that map to a first-party connector key. */
export const TOOL_SLUG_TO_CONNECTOR_KEY: Record<string, string> = {
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
  attio: "apollo",
  github: "linear",
  notion: "linear",
};

export const KNOWN_CONNECTOR_KEYS = new Set<string>(CONNECTOR_HEALTH_KEYS);

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
