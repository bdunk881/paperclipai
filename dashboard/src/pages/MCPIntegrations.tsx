import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiGet } from "../api/settingsClient";
import { getApiBasePath } from "../api/baseUrl";
import { trackedFetch } from "../api/trackedFetch";
import { ErrorState, LoadingState } from "../components/UiStates";
import {
  LIVE_CONNECTOR_PROVIDER_BY_KEY,
  type ProviderKey,
  type ProviderStatus,
} from "../integrations/liveConnectorCatalog";

/**
 * Integrations (MCP / Connect) page — v2 restyle.
 *
 * v2 reference: `docs/design/v2/pages-extra.jsx::AF2_Integrations` — `af2-page`
 * chrome with eyebrow "Connect", serif h1 "Integrations", a category
 * `af2-cluster` of pills, and a responsive `af2-card` grid where each card
 * shows a mark, name + category · auth method, description, status pill,
 * and a Connect/Manage CTA.
 *
 * The route is `/integrations/mcp`. Custom MCP server registration lives on
 * the `/settings/mcp-servers` page; this page surfaces a quick count of
 * registered custom servers and a CTA to the registry.
 */

interface IntegrationCard {
  id: string;
  name: string;
  category: string;
  auth: string;
  description: string;
  installed: boolean;
  ctaTo: string;
  status: "connected" | "available";
  /** Optional live provider key — when set, status follows the live connector. */
  liveProviderKey?: ProviderKey;
}

interface RegisteredIntegration {
  id: string;
  name: string;
  url: string;
  hasAuth: boolean;
  createdAt: string;
}

/**
 * Static catalog of integrations. The card grid is built from this list
 * cross-referenced with live provider statuses fetched from the backend.
 */
const CATALOG: Array<Omit<IntegrationCard, "installed" | "status" | "ctaTo">> = [
  {
    id: "github",
    name: "GitHub",
    category: "Developer Tools",
    auth: "OAuth",
    description: "Read and write GitHub repositories, issues, PRs, and code search.",
  },
  {
    id: "linear",
    name: "Linear",
    category: "Project Management",
    auth: "OAuth",
    description:
      "Sync projects and issues with Linear to automate triage, assignment, and status updates.",
    liveProviderKey: "linear",
  },
  {
    id: "slack",
    name: "Slack",
    category: "Communication",
    auth: "OAuth",
    description: "Send messages, read channels, and manage Slack workspaces.",
    liveProviderKey: "slack",
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    category: "Database",
    auth: "Connection string",
    description: "Query and mutate PostgreSQL databases with schema introspection.",
  },
  {
    id: "filesystem",
    name: "Filesystem",
    category: "Storage",
    auth: "Local",
    description: "Read and write files on your local or remote filesystem.",
  },
  {
    id: "brave",
    name: "Brave Search",
    category: "Search",
    auth: "API key",
    description: "Real-time web search via Brave's privacy-focused search API.",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    category: "CRM",
    auth: "OAuth",
    description: "Sync contacts, companies, and deals with HubSpot CRM.",
    liveProviderKey: "hubspot",
  },
  {
    id: "google",
    name: "Google Workspace",
    category: "Productivity",
    auth: "OAuth",
    description: "Send emails via Gmail and manage files in Google Drive.",
    liveProviderKey: "gmail",
  },
  {
    id: "stripe",
    name: "Stripe",
    category: "Payments",
    auth: "API key",
    description: "Manage payments, customers, subscriptions, and invoices via Stripe.",
    liveProviderKey: "stripe",
  },
  {
    id: "notion",
    name: "Notion",
    category: "Productivity",
    auth: "OAuth",
    description: "Read and write Notion pages, databases, and blocks.",
  },
  {
    id: "puppeteer",
    name: "Puppeteer",
    category: "Browser",
    auth: "Local",
    description: "Browser automation — navigate pages, click, fill forms, take screenshots.",
  },
  {
    id: "intercom",
    name: "Intercom",
    category: "Support",
    auth: "OAuth",
    description: "Sync customer data and manage conversations via Intercom.",
  },
  {
    id: "sanity",
    name: "Sanity",
    category: "Content",
    auth: "Token",
    description: "Query and mutate content in your Sanity CMS datasets.",
  },
  {
    id: "okta",
    name: "Okta",
    category: "Identity",
    auth: "OAuth",
    description: "Manage user access and authentication via Okta SSO.",
  },
  {
    id: "jira",
    name: "Jira",
    category: "Project Management",
    auth: "OAuth",
    description: "Automate Jira issue creation and project tracking.",
  },
  {
    id: "discord",
    name: "Discord",
    category: "Communication",
    auth: "Bot token",
    description: "Send notifications and manage community interactions via Discord.",
  },
  {
    id: "sentry",
    name: "Sentry",
    category: "Developer Tools",
    auth: "OAuth",
    description: "Track issues, releases, and project health via Sentry.",
    liveProviderKey: "sentry",
  },
  {
    id: "twitter",
    name: "Twitter",
    category: "Social",
    auth: "OAuth",
    description: "Schedule tweets and monitor mentions via X (Twitter).",
  },
  {
    id: "quickbooks",
    name: "Quickbooks",
    category: "Finance",
    auth: "OAuth",
    description: "Automate bookkeeping and financial reporting via Quickbooks.",
  },
];

const ALL_CATEGORY = "All";
// Resolves to the correct Fly API origin via getApiBasePath() — same logic
// every other dashboard fetch uses (handles dev / staging / production
// hostname maps + Cloudflare Pages preview surfaces).
const API_BASE = getApiBasePath();
const REGISTRY_ROUTE = "/settings/mcp-servers";
const LIVE_CONNECTOR_ROUTE = "/integrations";

function buildCards(liveStatuses: Record<ProviderKey, ProviderStatus> | null): IntegrationCard[] {
  return CATALOG.map((entry) => {
    if (entry.liveProviderKey) {
      const provider = LIVE_CONNECTOR_PROVIDER_BY_KEY[entry.liveProviderKey];
      const connected = liveStatuses?.[entry.liveProviderKey]?.connected ?? false;
      return {
        id: entry.id,
        name: entry.name,
        category: entry.category,
        auth: provider.supportsOAuth ? "OAuth" : "API key",
        description: entry.description,
        liveProviderKey: entry.liveProviderKey,
        installed: connected,
        status: connected ? "connected" : "available",
        ctaTo: LIVE_CONNECTOR_ROUTE,
      };
    }

    return {
      id: entry.id,
      name: entry.name,
      category: entry.category,
      auth: entry.auth,
      description: entry.description,
      installed: false,
      status: "available",
      ctaTo: REGISTRY_ROUTE,
    };
  });
}

export default function IntegrationsHub() {
  const { user, requireAccessToken } = useAuth();
  const [category, setCategory] = useState<string>(ALL_CATEGORY);
  const [registered, setRegistered] = useState<RegisteredIntegration[]>([]);
  const [loadingRegistered, setLoadingRegistered] = useState(true);
  const [registeredError, setRegisteredError] = useState<string | null>(null);
  const [liveStatuses, setLiveStatuses] = useState<Record<ProviderKey, ProviderStatus> | null>(
    null
  );
  const [loadingLiveStatuses, setLoadingLiveStatuses] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const accessToken = await requireAccessToken();
        const data = await apiGet<{ servers: RegisteredIntegration[] }>(
          "/api/mcp/servers",
          user,
          accessToken
        );
        if (!cancelled) {
          setRegistered(data.servers);
        }
      } catch (loadError) {
        if (!cancelled) {
          setRegisteredError(
            loadError instanceof Error ? loadError.message : "Failed to load custom integrations"
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingRegistered(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [requireAccessToken, user]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const accessToken = await requireAccessToken();
        const headers = new Headers();
        headers.set("Authorization", `Bearer ${accessToken}`);
        // getApiBasePath() already includes the `/api` suffix, so the path
        // here is just the route under the api mount.
        const response = await trackedFetch(`${API_BASE}/integrations/status`, { headers });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as {
          providers: Record<ProviderKey, ProviderStatus>;
        };
        if (!cancelled) {
          setLiveStatuses(payload.providers);
        }
      } catch {
        if (!cancelled) {
          setLiveStatuses(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingLiveStatuses(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [requireAccessToken]);

  const cards = useMemo(() => buildCards(liveStatuses), [liveStatuses]);

  const categories = useMemo(
    () => Array.from(new Set(cards.map((card) => card.category))).sort(),
    [cards]
  );

  const filtered = useMemo(
    () => cards.filter((card) => category === ALL_CATEGORY || card.category === category),
    [cards, category]
  );

  const totalCount = cards.length;
  const registeredCount = registered.length;

  return (
    <div className="af2-page">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Connect</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            Integrations
          </h1>
          <div className="af2-page-head-meta">
            Tools your agents can use. OAuth, app tokens, raw API — pick whatever your IT team
            prefers.
          </div>
        </div>
        <div className="af2-page-actions">
          <Link
            to={LIVE_CONNECTOR_ROUTE}
            className="af2-btn"
            style={{ textDecoration: "none" }}
          >
            Browse marketplace
          </Link>
          <Link
            to={REGISTRY_ROUTE}
            className="af2-btn af2-btn-primary"
            style={{ textDecoration: "none" }}
          >
            ＋ Custom MCP server
          </Link>
        </div>
      </div>

      <div className="af2-cluster" style={{ marginBottom: 18 }}>
        <button
          type="button"
          className={`af2-pill${category === ALL_CATEGORY ? " af2-pill-live" : ""}`}
          onClick={() => setCategory(ALL_CATEGORY)}
        >
          <span className="af2-dot" />
          All ({totalCount})
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`af2-pill${category === cat ? " af2-pill-live" : ""}`}
            onClick={() => setCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {loadingLiveStatuses && cards.length === 0 ? (
        <LoadingState label="Loading integrations..." />
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 12,
        }}
      >
        {filtered.map((card) => (
          <div key={card.id} className="af2-card" style={{ padding: 16 }}>
            <div className="af2-row">
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: "var(--af2-paper-2)",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <span className="font-af2-serif">{card.name.charAt(0)}</span>
              </div>
              <span className="af2-spacer" />
              {card.installed ? (
                <span className="af2-pill af2-pill-live">
                  <span className="af2-dot" />
                  connected
                </span>
              ) : (
                <span className="af2-pill">
                  <span className="af2-dot" />
                  available
                </span>
              )}
            </div>
            <div style={{ fontWeight: 600, marginTop: 12 }}>{card.name}</div>
            <div className="af2-muted" style={{ fontSize: 11.5, marginTop: 2 }}>
              {card.category} · {card.auth}
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: "var(--af2-ink-2)",
                marginTop: 10,
                lineHeight: 1.45,
                minHeight: 36,
              }}
            >
              {card.description}
            </div>
            <Link
              to={card.ctaTo}
              className="af2-btn af2-btn-sm"
              style={{
                marginTop: 12,
                width: "100%",
                textDecoration: "none",
                display: "inline-flex",
                justifyContent: "center",
              }}
            >
              {card.installed ? "Manage" : "Connect"}
            </Link>
          </div>
        ))}
      </div>

      {filtered.length === 0 && !loadingLiveStatuses ? (
        <div
          style={{
            marginTop: 22,
            padding: "40px 24px",
            textAlign: "center",
            border: "1px dashed var(--af2-line-2)",
            borderRadius: "var(--af2-radius-lg)",
            background: "var(--af2-card)",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--af2-ink-2)" }}>
            No integrations in this category yet.
          </div>
          <div className="af2-muted" style={{ marginTop: 6, fontSize: 12 }}>
            Try a different category or register a custom MCP server.
          </div>
        </div>
      ) : null}

      <div
        className="af2-card"
        style={{ marginTop: 22, padding: 16 }}
      >
        <div className="af2-row">
          <div>
            <div className="af2-eyebrow">Custom MCP servers</div>
            <div style={{ fontWeight: 600, marginTop: 6 }}>
              {registeredCount} custom MCP {registeredCount === 1 ? "server" : "servers"} registered
            </div>
            <div className="af2-muted" style={{ fontSize: 12, marginTop: 4 }}>
              Register your own MCP endpoints in the registry to expose them to agents.
            </div>
          </div>
          <span className="af2-spacer" />
          <Link
            to={REGISTRY_ROUTE}
            className="af2-btn af2-btn-sm"
            style={{ textDecoration: "none" }}
          >
            Manage registry
          </Link>
        </div>
        {registeredError ? (
          <div style={{ marginTop: 12 }}>
            <ErrorState title="Couldn't load custom servers" message={registeredError} />
          </div>
        ) : loadingRegistered ? (
          <div className="af2-muted" style={{ marginTop: 12, fontSize: 12 }}>
            Loading custom integrations…
          </div>
        ) : null}
      </div>
    </div>
  );
}
