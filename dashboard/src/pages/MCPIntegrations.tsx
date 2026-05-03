import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Plug, PlugZap, ExternalLink, CheckCircle, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiGet } from "../api/settingsClient";
import clsx from "clsx";
import {
  LIVE_CONNECTOR_PROVIDER_BY_KEY,
  type ProviderKey,
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
  rating?: number;
  connected?: boolean;
  logo?: string;
  liveProviderKey?: ProviderKey;
  rating?: number;
  connected?: boolean;
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
    rating: 4.4,
    connected: false,
    official: false,
    logo: notionLogo,
  },
  {
    id: "mcp-puppeteer",
    name: "Puppeteer",
    description: "Browser automation — navigate pages, click, fill forms, take screenshots.",
    category: "Browser",
    tools: ["navigate", "click", "type", "screenshot", "evaluate"],
    rating: 4.3,
    connected: false,
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

export default function IntegrationsHub() {
  const { user, requireAccessToken } = useAuth();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [registered, setRegistered] = useState<RegisteredIntegration[]>([]);
  const [loadingRegistered, setLoadingRegistered] = useState(true);

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
  }, [user, requireAccessToken]);

  const filtered = INTEGRATION_OPTIONS.filter((s) => {
    const matchSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase());
    const matchCategory = category === "All" || s.category === category;
    return matchSearch && matchCategory;
  });

  const registeredCount = registered.length;
  const recentRegistered = registered
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 4);

  return (
    <div className="min-h-full bg-surface-50 dark:bg-surface-950 transition-colors duration-200">
      {/* Header */}
      <div className="bg-white dark:bg-surface-900 border-b border-gray-200 dark:border-surface-800 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">Integrations Hub</h1>
              <span className="px-2 py-0.5 rounded-full bg-brand-50 dark:bg-brand-500/10 text-brand-600 dark:text-brand-300 text-xs font-medium">
                In Development
              </span>
            </div>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              Connect integrations to give your agents access to external tools and services.
            </p>
          </div>
          <div className="text-right space-y-1">
            <div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{registeredCount}</div>
              <div className="text-xs text-gray-400 uppercase font-bold tracking-wider">custom integrations</div>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-gray-200 dark:border-surface-800 bg-white dark:bg-surface-900/50 p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white tracking-tight">Custom Integration Activity</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Manage your registered integration servers and verify auth before using them in workflows.
              </p>
            </div>
            <Link
              to="/settings/integrations"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-2 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-surface-700 transition shadow-sm"
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
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 dark:border-surface-700 bg-gray-50 dark:bg-surface-800 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400"
                  title={item.url}
                >
                  <PlugZap size={11} className="text-brand-500" />
                  {item.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-gray-500 italic">No custom integrations registered yet.</p>
          )}
        </div>

        {/* Search + filter */}
        <div className="flex flex-col sm:flex-row gap-3 mt-6">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <input
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-surface-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-surface-800 dark:text-white transition-all"
              placeholder="Search servers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                  category === cat
                    ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow-sm"
                    : "bg-white dark:bg-surface-800 border border-gray-200 dark:border-surface-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-surface-600"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Server grid */}
      <div className="max-w-7xl mx-auto px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((server) => {
            const liveProvider = server.liveProviderKey ? LIVE_CONNECTOR_PROVIDER_BY_KEY[server.liveProviderKey] : null;
            
            return (
              <div
                key={server.id}
                className="bg-white dark:bg-surface-900 rounded-2xl border border-gray-200 dark:border-surface-800 p-5 hover:shadow-lg hover:border-brand-500/50 transition-all duration-300 group flex flex-col"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-gray-50 dark:bg-surface-800 flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-inner">
                    {server.logo ? (
                      <img src={server.logo} alt="" className="w-6 h-6 object-contain" />
                    ) : (
                      <PlugZap size={18} className="text-brand-500" />
                    )}
                  </div>

                  <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-bold uppercase tracking-wider">
                    {liveProvider ? "Live" : "Coming soon"}
                  </span>
                </div>

                <div className="mb-3">
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-bold text-gray-900 dark:text-slate-100 text-sm tracking-tight">{server.name}</h3>
                    {server.official && (
                      <CheckCircle size={12} className="text-blue-500" />
                    )}
                  </div>
                  <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest mt-0.5">{server.category}</p>
                </div>

                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2 flex-1">{server.description}</p>

                <div className="mt-4 flex flex-wrap gap-1">
                  {server.tools.slice(0, 2).map((tool) => (
                    <span
                      key={tool}
                      className="px-2 py-0.5 bg-gray-50 dark:bg-surface-950 text-gray-600 dark:text-gray-400 rounded text-[10px] font-mono border border-gray-100 dark:border-surface-800"
                    >
                      {tool}
                    </span>
                  ))}
                  {server.tools.length > 2 && (
                    <span className="px-2 py-0.5 text-gray-400 text-[10px] font-medium">
                      +{server.tools.length - 2} more
                    </span>
                  )}
                </div>

                <div className="flex gap-2 mt-5 pt-4 border-t border-gray-50 dark:border-surface-800">
                  <button
                    type="button"
                    disabled={!liveProvider}
                    className={clsx(
                      "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all shadow-sm",
                      liveProvider 
                        ? "bg-brand-600 text-white hover:bg-brand-500" 
                        : "bg-gray-100 dark:bg-surface-800 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-surface-700 cursor-not-allowed shadow-none"
                    )}
                  >
                    <Plug size={12} />
                    {liveProvider ? "Connect" : "Waitlist"}
                  </button>
                  <button className="px-2.5 py-2 rounded-lg border border-gray-200 dark:border-surface-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition shadow-sm hover:bg-gray-50 dark:hover:bg-surface-800">
                    <ExternalLink size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-24 text-gray-400">
            <PlugZap size={48} className="mx-auto mb-4 opacity-20" />
            <p className="text-sm font-medium tracking-tight">No integrations match your search</p>
          </div>
        )}
      </div>
    </div>
  );
}
