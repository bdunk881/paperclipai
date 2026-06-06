import { getApiBasePath } from "./baseUrl";
import { trackedFetch } from "./trackedFetch";

/**
 * Client for the Composio integration broker (HEL-746 / P2b-1).
 *
 * Backs the new Connections tab: the toolkit catalog (P2a `GET /api/composio/
 * toolkits`) joined with the workspace's connected accounts (P1c `GET
 * /api/composio/connections`), plus connect (P1b) and disconnect (P1c).
 *
 * Uses the standard dashboard client conventions (getApiBasePath + trackedFetch
 * + Bearer token). Includes a `VITE_USE_MOCK` path so the catalog renders
 * offline.
 */

const BASE = getApiBasePath();
const USE_MOCK_API = import.meta.env.VITE_USE_MOCK === "true";

export interface ComposioToolkitCategory {
  slug: string;
  name: string;
}

/** A connectable app, mirroring the broker's ToolkitCatalogEntry. */
export interface ComposioToolkit {
  slug: string;
  name: string;
  logo: string | null;
  description: string | null;
  categories: ComposioToolkitCategory[];
  toolsCount: number | null;
  triggersCount: number | null;
  authSchemes: string[];
  composioManagedAuthSchemes: string[];
  noAuth: boolean;
}

export interface ComposioToolkitPage {
  toolkits: ComposioToolkit[];
  total: number;
  nextCursor: string | null;
}

export type ComposioConnectionStatus = "INITIATED" | "ACTIVE" | "INACTIVE" | "EXPIRED";

/** A workspace's connection to a toolkit, mirroring the broker's ConnectionView. */
export interface ComposioConnection {
  connectedAccountId: string;
  toolkit: string;
  status: ComposioConnectionStatus;
  authConfigId: string;
  createdAt: string;
  updatedAt: string;
}

export interface FetchToolkitsParams {
  search?: string;
  category?: string;
  cursor?: string;
  limit?: number;
  /** Only toolkits connectable via managed auth today (the Connections-tab default). */
  connectableOnly?: boolean;
}

export interface StartConnectResult {
  redirectUrl: string | null;
  connectedAccountId: string;
  toolkit: string;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// ---------------------------------------------------------------------------
// Mock fixtures — VITE_USE_MOCK dev (no live broker). A small, realistic slice.
// ---------------------------------------------------------------------------

function mockToolkit(
  slug: string,
  name: string,
  _domain: string,
  description: string,
  catSlug: string,
  catName: string,
  toolsCount: number,
  triggersCount: number,
): ComposioToolkit {
  return {
    slug,
    name,
    // Offline/mock dev uses a letter fallback — real Composio toolkits carry meta.logo.
    logo: null,
    description,
    categories: [{ slug: catSlug, name: catName }],
    toolsCount,
    triggersCount,
    authSchemes: ["OAUTH2"],
    composioManagedAuthSchemes: ["OAUTH2"],
    noAuth: false,
  };
}

const MOCK_TOOLKITS: ComposioToolkit[] = [
  mockToolkit("github", "GitHub", "github.com", "Code hosting, issues, and pull requests.", "developer-tools", "Developer Tools", 64, 8),
  mockToolkit("gitlab", "GitLab", "gitlab.com", "Git repos, CI/CD, and merge requests.", "developer-tools", "Developer Tools", 38, 4),
  mockToolkit("linear", "Linear", "linear.app", "Issue tracking and project planning.", "developer-tools", "Developer Tools", 22, 5),
  mockToolkit("sentry", "Sentry", "sentry.io", "Error monitoring and alerting.", "developer-tools", "Developer Tools", 17, 3),
  mockToolkit("slack", "Slack", "slack.com", "Team messaging and notifications.", "communication", "Communication", 41, 6),
  mockToolkit("gmail", "Gmail", "gmail.com", "Send and read email.", "communication", "Communication", 19, 3),
  mockToolkit("discord", "Discord", "discord.com", "Community chat and bots.", "communication", "Communication", 15, 4),
  mockToolkit("notion", "Notion", "notion.so", "Docs, wikis, and databases.", "productivity", "Productivity", 23, 2),
  mockToolkit("asana", "Asana", "asana.com", "Tasks, projects, and workflows.", "productivity", "Productivity", 27, 3),
  mockToolkit("calendly", "Calendly", "calendly.com", "Scheduling and bookings.", "productivity", "Productivity", 9, 2),
  mockToolkit("hubspot", "HubSpot", "hubspot.com", "CRM, marketing, and sales pipelines.", "crm", "CRM", 58, 5),
  mockToolkit("salesforce", "Salesforce", "salesforce.com", "Enterprise CRM and automation.", "crm", "CRM", 72, 6),
  mockToolkit("stripe", "Stripe", "stripe.com", "Payments, invoices, and billing.", "payments", "Payments", 44, 9),
  mockToolkit("googledrive", "Google Drive", "google.com", "Files, folders, and sharing.", "storage", "Storage", 21, 2),
  mockToolkit("dropbox", "Dropbox", "dropbox.com", "Cloud file storage.", "storage", "Storage", 16, 1),
];

const MOCK_CONNECTIONS: ComposioConnection[] = [
  {
    connectedAccountId: "ca_mock_slack",
    toolkit: "slack",
    status: "ACTIVE",
    authConfigId: "ac_mock_slack",
    createdAt: "2026-06-06T00:00:00.000Z",
    updatedAt: "2026-06-06T00:00:00.000Z",
  },
];

function mockToolkitPage(params: FetchToolkitsParams): ComposioToolkitPage {
  const search = params.search?.trim().toLowerCase();
  let toolkits = MOCK_TOOLKITS;
  if (params.connectableOnly) {
    toolkits = toolkits.filter((t) => t.composioManagedAuthSchemes.length > 0 || t.noAuth);
  }
  if (params.category) {
    const category = params.category.trim().toLowerCase();
    toolkits = toolkits.filter((t) =>
      t.categories.some((c) => c.slug.toLowerCase() === category || c.name.toLowerCase() === category),
    );
  }
  if (search) {
    toolkits = toolkits.filter(
      (t) =>
        t.slug.includes(search) ||
        t.name.toLowerCase().includes(search) ||
        (t.description?.toLowerCase().includes(search) ?? false),
    );
  }
  return { toolkits, total: toolkits.length, nextCursor: null };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Fetch a page of the toolkit catalog (search / category / cursor / connectable). */
export async function fetchComposioToolkits(
  token: string,
  params: FetchToolkitsParams = {},
): Promise<ComposioToolkitPage> {
  if (USE_MOCK_API) {
    return mockToolkitPage(params);
  }

  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.category) query.set("category", params.category);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.connectableOnly) query.set("connectable", "true");
  const qs = query.toString();

  const response = await trackedFetch(`${BASE}/composio/toolkits${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch toolkits: ${response.status}`);
  }
  return (await response.json()) as ComposioToolkitPage;
}

/** List the workspace's Composio connections (status live-reconciled by the broker). */
export async function listComposioConnections(token: string): Promise<ComposioConnection[]> {
  if (USE_MOCK_API) {
    return [...MOCK_CONNECTIONS];
  }

  const response = await trackedFetch(`${BASE}/composio/connections`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Failed to list connections: ${response.status}`);
  }
  const payload = (await response.json()) as { connections: ComposioConnection[] };
  return payload.connections ?? [];
}

/**
 * Start a connection for a toolkit. Returns a `redirectUrl` the browser should
 * navigate to for the OAuth consent (null for non-redirect schemes).
 */
export async function startComposioConnect(
  token: string,
  toolkit: string,
  opts: { allowMultiple?: boolean } = {},
): Promise<StartConnectResult> {
  if (USE_MOCK_API) {
    return {
      redirectUrl: "https://example.com/composio-oauth-mock",
      connectedAccountId: `ca_mock_${toolkit}`,
      toolkit,
    };
  }

  const response = await trackedFetch(`${BASE}/composio/connect/${encodeURIComponent(toolkit)}`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ allowMultiple: opts.allowMultiple ?? false }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Couldn't start connection (${response.status}): ${detail.slice(0, 200)}`);
  }
  return (await response.json()) as StartConnectResult;
}

/** Disconnect a connected account (revokes at Composio + removes the record). */
export async function disconnectComposio(token: string, connectedAccountId: string): Promise<void> {
  if (USE_MOCK_API) {
    return;
  }

  const response = await trackedFetch(
    `${BASE}/composio/connections/${encodeURIComponent(connectedAccountId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to disconnect (${response.status})`);
  }
}
