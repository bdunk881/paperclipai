export interface McpPresetField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  required?: boolean;
  helpText?: string;
}

export interface McpPresetDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  official: boolean;
  logoSlug: string;
  authType: "apiKey" | "oauth" | "hybrid";
  defaultUrl: string;
  defaultAuthHeaderKey?: string;
  healthPath?: string;
  tools: string[];
  configFields: McpPresetField[];
}

const PRESETS: McpPresetDefinition[] = [
  {
    id: "github",
    name: "GitHub MCP",
    description: "Repository search, issues, pull requests, and file operations for software teams.",
    category: "Developer Tools",
    official: true,
    logoSlug: "github",
    authType: "hybrid",
    defaultUrl: "https://api.githubcopilot.com/mcp/",
    defaultAuthHeaderKey: "Authorization",
    tools: ["search_code", "get_file", "create_issue", "list_prs", "comment_on_pr"],
    configFields: [
      {
        key: "authHeaderValue",
        label: "Personal access token",
        placeholder: "Bearer ghp_...",
        secret: true,
        required: true,
        helpText: "Use a GitHub PAT or installation token with repo and issue scopes.",
      },
    ],
  },
  {
    id: "slack",
    name: "Slack MCP",
    description: "Channel read/write, thread retrieval, and workspace automation.",
    category: "Communication",
    official: true,
    logoSlug: "slack",
    authType: "hybrid",
    defaultUrl: "https://mcp.slack.com",
    defaultAuthHeaderKey: "Authorization",
    tools: ["send_message", "list_channels", "get_thread", "add_reaction"],
    configFields: [
      {
        key: "authHeaderValue",
        label: "Bot token",
        placeholder: "Bearer xoxb-...",
        secret: true,
        required: true,
        helpText: "Install the Slack app and paste a bot token with channel history and chat scopes.",
      },
    ],
  },
  {
    id: "postgresql",
    name: "PostgreSQL MCP",
    description: "Schema introspection plus safe query and mutation tooling for Postgres databases.",
    category: "Database",
    official: true,
    logoSlug: "postgresql",
    authType: "apiKey",
    defaultUrl: "https://mcp.postgres.autoflow.dev/query",
    defaultAuthHeaderKey: "Authorization",
    healthPath: "/health",
    tools: ["list_tables", "describe_table", "query", "execute"],
    configFields: [
      {
        key: "authHeaderValue",
        label: "Database access token",
        placeholder: "Bearer sk_live_...",
        secret: true,
        required: true,
        helpText: "Provision a database-scoped token from the Postgres MCP host.",
      },
    ],
  },
  {
    id: "brave-search",
    name: "Brave Search MCP",
    description: "Real-time web, news, and image search through Brave Search.",
    category: "Search",
    official: false,
    logoSlug: "brave-search",
    authType: "apiKey",
    defaultUrl: "https://mcp.bravesearch.com",
    defaultAuthHeaderKey: "X-Subscription-Token",
    tools: ["web_search", "news_search", "image_search"],
    configFields: [
      {
        key: "authHeaderValue",
        label: "Brave API key",
        placeholder: "BSA_...",
        secret: true,
        required: true,
        helpText: "Paste the Brave Search API key issued for your account.",
      },
    ],
  },
  {
    id: "browserless",
    name: "Browserless MCP",
    description: "Remote browser automation for screenshots, scraping, and scripted navigation.",
    category: "Browser",
    official: false,
    logoSlug: "browserless",
    authType: "apiKey",
    defaultUrl: "https://production-sfo.browserless.io/mcp",
    defaultAuthHeaderKey: "Authorization",
    tools: ["navigate", "click", "type", "screenshot", "evaluate"],
    configFields: [
      {
        key: "authHeaderValue",
        label: "Browserless token",
        placeholder: "Bearer bl_...",
        secret: true,
        required: true,
        helpText: "Use the Browserless token for your workspace.",
      },
    ],
  },
];

export function listMcpPresets(): McpPresetDefinition[] {
  return PRESETS.map((preset) => ({ ...preset, configFields: preset.configFields.map((field) => ({ ...field })) }));
}

export function getMcpPreset(presetId: string): McpPresetDefinition | undefined {
  return PRESETS.find((preset) => preset.id === presetId);
}
