import { AgentCatalogConnectorError, AgentCatalogProvider } from "./types";

interface OAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  redirectUriEnv: string;
  defaultScopes: string[];
}

interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  scopes: string[];
}

interface ProviderIdentity {
  accountLabel: string;
}

const NOTION_VERSION = process.env.NOTION_API_VERSION ?? "2022-06-28";

const PROVIDER_CONFIG: Record<AgentCatalogProvider, OAuthConfig> = {
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientIdEnv: "AGENT_CATALOG_GOOGLE_CLIENT_ID",
    clientSecretEnv: "AGENT_CATALOG_GOOGLE_CLIENT_SECRET",
    redirectUriEnv: "AGENT_CATALOG_GOOGLE_REDIRECT_URI",
    defaultScopes: ["openid", "email", "profile"],
  },
  github: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    clientIdEnv: "AGENT_CATALOG_GITHUB_CLIENT_ID",
    clientSecretEnv: "AGENT_CATALOG_GITHUB_CLIENT_SECRET",
    redirectUriEnv: "AGENT_CATALOG_GITHUB_REDIRECT_URI",
    defaultScopes: ["read:user", "user:email", "repo"],
  },
  notion: {
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    clientIdEnv: "AGENT_CATALOG_NOTION_CLIENT_ID",
    clientSecretEnv: "AGENT_CATALOG_NOTION_CLIENT_SECRET",
    redirectUriEnv: "AGENT_CATALOG_NOTION_REDIRECT_URI",
    defaultScopes: [],
  },
};

function configFor(provider: AgentCatalogProvider): OAuthConfig {
  return PROVIDER_CONFIG[provider];
}

function envOrThrow(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new AgentCatalogConnectorError("schema", `${name} is not configured`, 503);
  }
  return value.trim();
}

export function buildAuthorizationUrl(params: {
  provider: AgentCatalogProvider;
  state: string;
  codeChallenge: string;
}): string {
  const config = configFor(params.provider);
  const clientId = envOrThrow(config.clientIdEnv);
  const redirectUri = envOrThrow(config.redirectUriEnv);

  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  });

  if (params.provider === "google") {
    query.set("scope", config.defaultScopes.join(" "));
    query.set("access_type", "offline");
    query.set("prompt", "consent");
    query.set("include_granted_scopes", "true");
  }

  if (params.provider === "github") {
    query.set("scope", config.defaultScopes.join(" "));
  }

  if (params.provider === "notion") {
    query.set("owner", "user");
  }

  return `${config.authorizeUrl}?${query.toString()}`;
}

export async function exchangeCodeForToken(params: {
  provider: AgentCatalogProvider;
  code: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  const config = configFor(params.provider);
  const clientId = envOrThrow(config.clientIdEnv);
  const clientSecret = envOrThrow(config.clientSecretEnv);
  const redirectUri = envOrThrow(config.redirectUriEnv);

  if (params.provider === "notion") {
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: redirectUri,
        code_verifier: params.codeVerifier,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !body?.access_token || typeof body.access_token !== "string") {
      const message = typeof body?.error_description === "string"
        ? body.error_description
        : typeof body?.error === "string"
          ? body.error
          : response.statusText;
      throw new AgentCatalogConnectorError("auth", `Notion OAuth token exchange failed: ${message}`, 401);
    }

    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
      scopes: typeof body.workspace_id === "string" ? [body.workspace_id] : [],
    };
  }

  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code: params.code,
    code_verifier: params.codeVerifier,
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form.toString(),
  });

  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !body?.access_token || typeof body.access_token !== "string") {
    const message = typeof body?.error_description === "string"
      ? body.error_description
      : typeof body?.error === "string"
        ? body.error
        : response.statusText;
    throw new AgentCatalogConnectorError("auth", `${params.provider} OAuth token exchange failed: ${message}`, 401);
  }

  const rawScope = typeof body.scope === "string" ? body.scope : "";
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    scopes: rawScope ? rawScope.split(/[\s,]+/).filter(Boolean) : config.defaultScopes,
  };
}

export async function fetchProviderIdentity(provider: AgentCatalogProvider, accessToken: string): Promise<ProviderIdentity> {
  if (provider === "google") {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      throw new AgentCatalogConnectorError("auth", "Google verification failed", 401);
    }
    const email = typeof body?.email === "string" ? body.email : "Google account";
    return { accountLabel: email };
  }

  if (provider === "github") {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "autoflow-agent-catalog",
      },
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      throw new AgentCatalogConnectorError("auth", "GitHub verification failed", 401);
    }
    const login = typeof body?.login === "string" ? body.login : "GitHub account";
    return { accountLabel: login };
  }

  const response = await fetch("https://api.notion.com/v1/users?page_size=1", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Notion-Version": NOTION_VERSION,
    },
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new AgentCatalogConnectorError("auth", "Notion verification failed", 401);
  }
  const workspaceName = typeof body?.workspace_name === "string" ? body.workspace_name : "Notion workspace";
  return { accountLabel: workspaceName };
}
