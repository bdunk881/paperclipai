export type ProviderKey =
  | "apollo"
  | "gmail"
  | "hubspot"
  | "sentry"
  | "slack"
  | "stripe"
  | "composio";

export interface ProviderStatus {
  connected: boolean;
  connectedAt?: string;
  scopes?: string[];
}

export interface ProviderMeta {
  key: ProviderKey;
  name: string;
  category: string;
  authMode: "oauth" | "api_key";
  description: string;
}

export const LIVE_CONNECTOR_PROVIDERS: ProviderMeta[] = [
  {
    key: "apollo",
    name: "Apollo",
    category: "Sales",
    authMode: "oauth",
    description: "Lead enrichment and prospect data with OAuth plus API-key fallback.",
  },
  {
    key: "gmail",
    name: "Gmail",
    category: "Communication",
    authMode: "oauth",
    description: "Mailbox access for inbound message workflows and agent-driven replies.",
  },
  {
    key: "hubspot",
    name: "HubSpot",
    category: "CRM",
    authMode: "oauth",
    description: "Contacts, companies, deals, webhook intake, and health checks.",
  },
  {
    key: "sentry",
    name: "Sentry",
    category: "Developer Tools",
    authMode: "oauth",
    description: "Issue and project sync with signed webhooks and PKCE auth.",
  },
  {
    key: "slack",
    name: "Slack",
    category: "Communication",
    authMode: "oauth",
    description: "Workspace access for messaging, triage, and agent notifications.",
  },
  {
    key: "stripe",
    name: "Stripe",
    category: "Payments",
    authMode: "oauth",
    description: "Customers, subscriptions, invoices, and payment workflow triggers.",
  },
  {
    key: "composio",
    name: "Composio",
    category: "Automation",
    authMode: "api_key",
    description: "Connected accounts, trigger fan-out, and tool execution via API key.",
  },
];

export const LIVE_CONNECTOR_PROVIDER_BY_KEY = Object.fromEntries(
  LIVE_CONNECTOR_PROVIDERS.map((provider) => [provider.key, provider])
) as Record<ProviderKey, ProviderMeta>;
