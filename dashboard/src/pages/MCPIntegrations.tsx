import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Plug, PlugZap, Tag, ExternalLink, CheckCircle, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiGet } from "../api/settingsClient";
import {
  LIVE_CONNECTOR_PROVIDER_BY_KEY,
  type ProviderKey,
  type ProviderStatus,
} from "../integrations/liveConnectorCatalog";

import githubLogo from "../assets/integrations/github.svg";
import linearLogo from "../assets/integrations/linear.svg";
import slackLogo from "../assets/integrations/slack.svg";
import postgresLogo from "../assets/integrations/postgresql.svg";
import notionLogo from "../assets/integrations/notion.svg";
import stripeLogo from "../assets/integrations/stripe.svg";
import hubspotLogo from "../assets/integrations/hubspot.svg";
import googleLogo from "../assets/integrations/google.svg";
import braveLogo from "../assets/integrations/brave-search.svg";
import filesystemLogo from "../assets/integrations/filesystem.svg";
import puppeteerLogo from "../assets/integrations/puppeteer.svg";
import intercomLogo from "../assets/integrations/intercom.svg";
import sanityLogo from "../assets/integrations/sanity.svg";
import oktaLogo from "../assets/integrations/okta.svg";
import jiraLogo from "../assets/integrations/jira.svg";
import discordLogo from "../assets/integrations/discord.svg";
import gmailLogo from "../assets/integrations/gmail.svg";
import twitterLogo from "../assets/integrations/twitter.svg";
import quickbooksLogo from "../assets/integrations/quickbooks.svg";

interface IntegrationOption {
  id: string;
  name: string;
  description: string;
  category: string;
  tools: string[];
  official: boolean;
  logo?: string;
  liveProviderKey?: ProviderKey;
}

interface RegisteredIntegration {
  id: string;
  name: string;
  url: string;
  hasAuth: boolean;
  createdAt: string;
}

const INTEGRATION_OPTIONS: IntegrationOption[] = [
  {
    id: "mcp-github",
    name: "GitHub",
    description: "Read and write GitHub repositories, issues, PRs, and code search.",
    category: "Developer Tools",
    tools: ["search_code", "create_issue", "list_prs", "get_file", "push_commit"],
    official: true,
    logo: githubLogo,
  },
  {
    id: "mcp-linear",
    name: "Linear",
    description: "Sync projects and issues with Linear to automate triage, assignment, and status updates.",
    category: "Project Management",
    tools: ["list_teams", "list_issues", "create_issue", "update_issue"],
    official: true,
    logo: linearLogo,
  },
  {
    id: "mcp-slack",
    name: "Slack",
    description: "Send messages, read channels, and manage Slack workspaces.",
    category: "Communication",
    tools: ["send_message", "list_channels", "get_thread", "add_reaction"],
    official: true,
    logo: slackLogo,
    liveProviderKey: "slack",
  },
  {
    id: "mcp-postgres",
    name: "PostgreSQL",
    description: "Query and mutate PostgreSQL databases with schema introspection.",
    category: "Database",
    tools: ["query", "execute", "list_tables", "describe_table"],
    official: true,
    logo: postgresLogo,
  },
  {
    id: "mcp-filesystem",
    name: "Filesystem",
    description: "Read and write files on your local or remote filesystem.",
    category: "Storage",
    tools: ["read_file", "write_file", "list_directory", "move_file", "delete_file"],
    official: true,
    logo: filesystemLogo,
  },
  {
    id: "mcp-brave",
    name: "Brave Search",
    description: "Real-time web search via Brave's privacy-focused search API.",
    category: "Search",
    tools: ["web_search", "news_search", "image_search"],
    official: false,
    logo: braveLogo,
  },
  {
    id: "mcp-hubspot",
    name: "HubSpot",
    description: "Sync contacts, companies, and deals with HubSpot CRM.",
    category: "CRM",
    tools: ["get_contact", "update_deal", "list_companies"],
    rating: 4.7,
    connected: false,
    official: true,
    logo: hubspotLogo,
  },
  {
    id: "mcp-google",
    name: "Google Workspace",
    description: "Send emails via Gmail and manage files in Google Drive.",
    category: "Productivity",
    tools: ["send_email", "list_files", "create_doc"],
    rating: 4.8,
    connected: false,
    official: true,
    logo: googleLogo,
  },
  {
    id: "mcp-stripe",
    name: "Stripe",
    description: "Manage payments, customers, subscriptions, and invoices via Stripe.",
    category: "Payments",
    tools: ["create_customer", "charge_card", "list_subscriptions", "create_invoice"],
    official: true,
    logo: stripeLogo,
    liveProviderKey: "stripe",
  },
  {
    id: "mcp-notion",
    name: "Notion",
    description: "Read and write Notion pages, databases, and blocks.",
    category: "Productivity",
    tools: ["get_page", "create_page", "query_database", "update_block"],
    official: false,
    logo: notionLogo,
  },
  {
    id: "mcp-puppeteer",
    name: "Puppeteer",
    description: "Browser automation — navigate pages, click, fill forms, take screenshots.",
    category: "Browser",
    tools: ["navigate", "click", "type", "screenshot", "evaluate"],
    official: false,
    logo: puppeteerLogo,
  },
  {
    id: "mcp-intercom",
    name: "Intercom",
    description: "Sync customer data and manage conversations via Intercom.",
    category: "Support",
    tools: ["get_contact", "list_conversations", "send_reply"],
    rating: 4.7,
    connected: false,
    official: true,
    logo: intercomLogo,
  },
  {
    id: "mcp-sanity",
    name: "Sanity",
    description: "Query and mutate content in your Sanity CMS datasets.",
    category: "Content",
    tools: ["query_content", "create_document", "patch_document"],
    rating: 4.6,
    connected: false,
    official: false,
    logo: sanityLogo,
  },
  {
    id: "mcp-okta",
    name: "Okta",
    description: "Manage user access and authentication via Okta SSO.",
    category: "Identity",
    tools: ["list_users", "get_user", "update_user_status"],
    rating: 4.8,
    connected: false,
    official: true,
    logo: oktaLogo,
  },
  {
    id: "mcp-jira",
    name: "Jira",
    description: "Automate Jira issue creation and project tracking.",
    category: "Project Management",
    tools: ["create_issue", "update_issue", "list_projects"],
    rating: 4.7,
    connected: false,
    official: true,
    logo: jiraLogo,
  },
  {
    id: "mcp-discord",
    name: "Discord",
    description: "Send notifications and manage community interactions via Discord.",
    category: "Communication",
    tools: ["send_message", "list_guilds", "add_member"],
    rating: 4.5,
    connected: false,
    official: false,
    logo: discordLogo,
  },
  {
    id: "mcp-gmail",
    name: "Gmail",
    description: "Send emails and manage inbox workflows via Gmail.",
    category: "Productivity",
    tools: ["send_email", "list_messages", "create_draft"],
    rating: 4.9,
    connected: false,
    official: true,
    logo: gmailLogo,
  },
  {
    id: "mcp-twitter",
    name: "Twitter",
    description: "Schedule tweets and monitor mentions via X (Twitter).",
    category: "Social",
    tools: ["create_tweet", "get_mentions", "search_tweets"],
    rating: 4.4,
    connected: false,
    official: false,
    logo: twitterLogo,
  },
  {
    id: "mcp-quickbooks",
    name: "Quickbooks",
    description: "Automate bookkeeping and financial reporting via Quickbooks.",
    category: "Finance",
    tools: ["list_invoices", "create_expense", "get_reports"],
    rating: 4.7,
    connected: false,
    official: true,
    logo: quickbooksLogo,
  },
];

const CATEGORIES = ["All", ...Array.from(new Set(INTEGRATION_OPTIONS.map((s) => s.category))).sort()];
const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

function formatAvailability(option: IntegrationOption, liveStatuses: Record<ProviderKey, ProviderStatus> | null) {
  if (!option.liveProviderKey) {
    return {
      badgeClassName: "bg-slate-100 text-slate-700",
      badgeLabel: "Registry required",
      helperText: "No native AutoFlow setup flow yet. Register a compatible MCP server in the Integration Registry.",
      ctaLabel: "Register server",
      ctaTo: "/settings/mcp-servers",
      title: "This entry relies on a custom MCP server. Add your endpoint in the Integration Registry.",
    };
  }

  const provider = LIVE_CONNECTOR_PROVIDER_BY_KEY[option.liveProviderKey];
  const status = liveStatuses?.[option.liveProviderKey];

  if (status?.connected) {
    return {
      badgeClassName: "bg-green-100 text-green-700",
      badgeLabel: "Connected",
      helperText: `${provider.name} is already connected through the live connector setup surface.`,
      ctaLabel: "Manage connection",
      ctaTo: "/integrations",
      title: `Open the live ${provider.name} connector setup page.`,
    };
  }

  return {
    badgeClassName: "bg-blue-50 text-blue-700",
    badgeLabel: provider.supportsOAuth ? "Setup available" : "API-key setup",
    helperText:
      provider.supportsOAuth
        ? `${provider.name} has a live connector setup flow in AutoFlow today.`
        : `${provider.name} is configured through the live API-key connector surface.`,
    ctaLabel: "Open connector setup",
    ctaTo: "/integrations",
    title: `Open the live ${provider.name} connector setup page.`,
  };
}

export default function IntegrationsHub() {
  const { user, requireAccessToken } = useAuth();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [registered, setRegistered] = useState<RegisteredIntegration[]>([]);
  const [loadingRegistered, setLoadingRegistered] = useState(true);
  const [liveStatuses, setLiveStatuses] = useState<Record<ProviderKey, ProviderStatus> | null>(null);
  const [loadingLiveStatuses, setLoadingLiveStatuses] = useState(true);

  useEffect(() => {
    async function loadRegistered() {
      try {
        const accessToken = await requireAccessToken();
        const data = await apiGet<{ servers: RegisteredIntegration[] }>("/api/mcp/servers", user, accessToken);
        setRegistered(data.servers);
      } finally {
        setLoadingRegistered(false);
      }
    }
    void loadRegistered();
  }, [requireAccessToken, user]);

  useEffect(() => {
    async function loadLiveStatuses() {
      try {
        const accessToken = await requireAccessToken();
        const headers = new Headers();
        headers.set("Authorization", `Bearer ${accessToken}`);

        const response = await fetch(`${API_BASE}/api/integrations/status`, { headers });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as { providers: Record<ProviderKey, ProviderStatus> };
        setLiveStatuses(payload.providers);
      } catch {
        setLiveStatuses(null);
      } finally {
        setLoadingLiveStatuses(false);
      }
    }

    void loadLiveStatuses();
  }, [requireAccessToken]);

  const filtered = useMemo(
    () =>
      INTEGRATION_OPTIONS.filter((option) => {
        const matchSearch =
          option.name.toLowerCase().includes(search.toLowerCase()) ||
          option.description.toLowerCase().includes(search.toLowerCase());
        const matchCategory = category === "All" || option.category === category;
        return matchSearch && matchCategory;
      }),
    [category, search]
  );

  const liveSetupOptions = INTEGRATION_OPTIONS.filter((option) => option.liveProviderKey);
  const connectedLiveCount = liveSetupOptions.reduce((count, option) => {
    if (option.liveProviderKey && liveStatuses?.[option.liveProviderKey]?.connected) {
      return count + 1;
    }
    return count;
  }, 0);
  const registeredCount = registered.length;
  const recentRegistered = registered
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 4);

  return (
    <div className="min-h-full bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-8 py-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Integrations Hub</h1>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                Live connector setup
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Use the live connector setup page for supported SaaS providers, and use the Integration Registry for
              custom MCP servers that do not have a native AutoFlow setup flow yet.
            </p>
          </div>
          <div className="text-right space-y-1">
            <div>
              <div className="text-2xl font-bold text-gray-900">{registeredCount}</div>
              <div className="text-xs text-gray-400">custom MCP servers registered</div>
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-700">
                {loadingLiveStatuses ? "…" : `${connectedLiveCount}/${liveSetupOptions.length}`}
              </div>
              <div className="text-xs text-gray-400">cards with live setup already connected</div>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">Custom Integration Activity</p>
              <p className="mt-1 text-xs text-gray-500">
                Register your own MCP servers here. For Slack and Stripe, open the live connector setup surface instead
                of treating them as coming-soon marketplace entries.
              </p>
            </div>
            <Link
              to="/settings/mcp-servers"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Manage registry
              <ExternalLink size={12} />
            </Link>
          </div>
          {loadingRegistered ? (
            <div className="mt-3 inline-flex items-center gap-2 text-xs text-gray-500">
              <Loader2 size={12} className="animate-spin" />
              Loading custom integrations…
            </div>
          ) : recentRegistered.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {recentRegistered.map((item) => (
                <span
                  key={item.id}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700"
                  title={item.url}
                >
                  <PlugZap size={11} />
                  {item.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-gray-500">No custom integrations registered yet.</p>
          )}
        </div>

        <div className="mt-5 flex gap-3">
          <div className="relative max-w-sm flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search servers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-1">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  category === cat
                    ? "bg-gray-900 text-white"
                    : "border border-gray-200 bg-white text-gray-500 hover:border-gray-300"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-8 py-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((server) => {
            const availability = formatAvailability(server, liveStatuses);
            const logo = server.logo ? (
              <img src={server.logo} alt={`${server.name} logo`} className="h-6 w-6 object-contain" />
            ) : (
              <PlugZap size={16} className="text-gray-600 dark:text-gray-400" />
            );

            return (
              <div
                key={server.id}
                className="group rounded-xl border border-gray-200 bg-white p-5 transition-all duration-300 hover:border-indigo-500/50 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-500/50"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 transition-transform duration-300 group-hover:scale-110 dark:from-slate-800 dark:to-slate-900">
                      {logo}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{server.name}</span>
                        {server.official && <CheckCircle size={12} className="text-blue-500 dark:text-blue-400" />}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                        <Tag size={9} />
                        {server.category}
                      </div>
                    </div>
                  </div>

                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${availability.badgeClassName}`}>
                    {availability.badgeLabel}
                  </span>
                </div>

                <p className="mt-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{server.description}</p>

                <div className="mt-3 flex flex-wrap gap-1">
                  {server.tools.slice(0, 3).map((tool) => (
                    <span
                      key={tool}
                      className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600 dark:bg-slate-800 dark:text-gray-300"
                    >
                      {tool}
                    </span>
                  ))}
                  {server.tools.length > 3 && (
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-400 dark:bg-slate-800 dark:text-gray-500">
                      +{server.tools.length - 3} more
                    </span>
                  )}
                </div>

                <p className="mt-3 text-xs leading-relaxed text-gray-500">{availability.helperText}</p>

                <div className="mt-4 flex gap-2 border-t border-gray-100 pt-3 dark:border-slate-800">
                  <Link
                    to={availability.ctaTo}
                    title={availability.title}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                  >
                    <Plug size={12} />
                    {availability.ctaLabel}
                  </Link>
                  <Link
                    to={availability.ctaTo}
                    title={availability.title}
                    className="rounded-lg border border-gray-200 px-2.5 py-2 text-gray-400 transition hover:border-gray-300 hover:text-gray-600 dark:border-slate-800 dark:hover:border-slate-700 dark:hover:text-gray-200"
                  >
                    <ExternalLink size={12} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="py-16 text-center text-gray-400">
            <PlugZap size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No integrations match your search</p>
          </div>
        )}
      </div>
    </div>
  );
}
