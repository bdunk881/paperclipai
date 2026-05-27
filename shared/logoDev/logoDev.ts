/**
 * Logo.dev image CDN helpers.
 *
 * Publishable key docs: https://www.logo.dev/docs/logo-images/introduction
 * Domain lookup is preferred over name lookup (faster + more accurate).
 */

const LOGO_DEV_BASE = "https://img.logo.dev";

/** Known integration / provider id → verified domain for logo.dev. */
export const INTEGRATION_LOGO_DOMAINS: Record<string, string> = {
  // Connectors (live + catalog ids)
  slack: "slack.com",
  gmail: "google.com",
  teams: "microsoft.com",
  discord: "discord.com",
  hubspot: "hubspot.com",
  apollo: "apollo.io",
  linear: "linear.app",
  github: "github.com",
  sentry: "sentry.io",
  stripe: "stripe.com",
  notion: "notion.so",
  intercom: "intercom.com",
  sanity: "sanity.io",
  composio: "composio.dev",
  attio: "attio.com",
  google: "google.com",
  postgresql: "postgresql.org",
  posthog: "posthog.com",
  datadog: "datadoghq.com",
  jira: "atlassian.com",
  zendesk: "zendesk.com",
  shopify: "shopify.com",
  salesforce: "salesforce.com",
  docusign: "docusign.com",
  figma: "figma.com",
  linkedin: "linkedin.com",
  twitter: "x.com",
  vercel: "vercel.com",
  // LLM providers
  openai: "openai.com",
  anthropic: "anthropic.com",
  gemini: "google.com",
  mistral: "mistral.ai",
  groq: "groq.com",
  fireworks: "fireworks.ai",
  together: "together.ai",
  ollama: "ollama.com",
  localai: "localai.io",
  cohere: "cohere.com",
  perplexity: "perplexity.ai",
  xai: "x.ai",
  deepseek: "deepseek.com",
  bedrock: "aws.amazon.com",
  "vertex-ai": "cloud.google.com",
};

export interface LogoDevUrlOptions {
  /** Brand display name — used when domain is unknown (name lookup). */
  name: string;
  /** Preferred: verified domain, e.g. `stripe.com`. */
  domain?: string;
  /** Logo.dev publishable key (`pk_…`). */
  token: string;
  size?: number;
  format?: "png" | "jpg" | "webp";
  theme?: "auto" | "light" | "dark";
  /** When true, logo.dev returns 404 instead of a monogram placeholder. */
  fallback404?: boolean;
}

export function getLogoDevPublishableKey(): string {
  const viteEnv =
    typeof import.meta !== "undefined"
      ? (import.meta as unknown as { env?: { VITE_LOGO_DEV_PUBLISHABLE_KEY?: string } }).env
      : undefined;
  const viteKey = viteEnv?.VITE_LOGO_DEV_PUBLISHABLE_KEY
    ? String(viteEnv.VITE_LOGO_DEV_PUBLISHABLE_KEY)
    : "";
  if (viteKey.trim()) return viteKey.trim();

  const nextKey =
    typeof process !== "undefined" && process.env?.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY
      ? String(process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY)
      : "";
  if (nextKey.trim()) return nextKey.trim();

  return "";
}

export function resolveIntegrationLogoDomain(idOrKey: string): string | undefined {
  const normalized = idOrKey.trim().toLowerCase();
  return INTEGRATION_LOGO_DOMAINS[normalized];
}

export function buildLogoDevUrl(options: LogoDevUrlOptions): string {
  const {
    name,
    domain,
    token,
    size = 128,
    format = "png",
    theme = "auto",
    fallback404 = true,
  } = options;

  const slug = domain?.trim() || encodeURIComponent(name.trim());
  const path = domain ? slug : `name/${encodeURIComponent(name.trim())}`;

  const params = new URLSearchParams({
    token,
    size: String(size),
    format,
    theme,
  });
  if (fallback404) {
    params.set("fallback", "404");
  }

  return `${LOGO_DEV_BASE}/${path}?${params.toString()}`;
}

export function buildIntegrationLogoUrl(
  idOrKey: string,
  displayName: string,
  token: string,
  size = 64,
): string | null {
  if (!token) return null;
  const domain = resolveIntegrationLogoDomain(idOrKey);
  return buildLogoDevUrl({
    name: displayName,
    domain,
    token,
    size,
  });
}
