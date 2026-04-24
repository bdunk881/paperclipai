import { Configuration, PopupRequest } from "@azure/msal-browser";

// Entra External ID (CIAM) uses the branded custom auth host.
// Supported env vars in .env.local (dev) or Vercel (prod):
//   VITE_AZURE_CIAM_AUTHORITY         — optional full authority URL, e.g. "https://auth.helloautoflow.com/<tenant-id>"
//   VITE_AZURE_CIAM_KNOWN_AUTHORITIES — optional comma-separated authority hosts, e.g. "auth.helloautoflow.com"
//   VITE_AZURE_CIAM_TENANT_ID         — optional tenant GUID for the default authority path

// autoflow-dashboard app registration (recreated 2026-04-17, ALT-1257)
const DEFAULT_CIAM_CLIENT_ID = "2dfd3a08-277c-4893-b07d-eca5ae322310";
const DEFAULT_CIAM_AUTHORITY_HOST = "https://auth.helloautoflow.com";
const DEFAULT_CIAM_TENANT_ID = "5e4f1080-8afc-4005-b05e-32b21e69363a";
const DEFAULT_CIAM_KNOWN_AUTHORITIES = ["auth.helloautoflow.com"];

const HOSTNAME_REGEX =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

function readNonEmptyEnv(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.toLowerCase() === "undefined" || normalized.toLowerCase() === "null") {
    return null;
  }
  return normalized;
}

function normalizeAuthority(value: string | undefined): string | null {
  const normalized = readNonEmptyEnv(value);
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      return null;
    }

    const normalizedPath = url.pathname.replace(/\/+$/, "");
    return normalizedPath ? `${url.origin}${normalizedPath}` : url.origin;
  } catch {
    return null;
  }
}

function readAuthority(value: string | undefined, fallbackAuthority: string): string {
  const normalized = readNonEmptyEnv(value);
  if (!normalized) return fallbackAuthority;

  const parsed = normalizeAuthority(normalized);
  if (!parsed) {
    console.warn("[MSAL] Invalid VITE_AZURE_CIAM_AUTHORITY format. Using fallback authority.");
    return fallbackAuthority;
  }

  return parsed;
}

function readKnownAuthorities(value: string | undefined, fallbackAuthorities: string[]): string[] {
  const normalized = readNonEmptyEnv(value);
  if (!normalized) return fallbackAuthorities;

  const parsed = normalized
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (parsed.length === 0 || parsed.some((entry) => !HOSTNAME_REGEX.test(entry))) {
    console.warn(
      "[MSAL] Invalid VITE_AZURE_CIAM_KNOWN_AUTHORITIES format. Using fallback knownAuthorities."
    );
    return fallbackAuthorities;
  }

  return parsed;
}

// Use defaults directly. Env var overrides are only applied for tenant
// config; the client ID is pinned to the app registration above to avoid
// stale env var overrides in Vercel.
const clientId = DEFAULT_CIAM_CLIENT_ID;
const tenantId = readNonEmptyEnv(import.meta.env.VITE_AZURE_CIAM_TENANT_ID) ?? DEFAULT_CIAM_TENANT_ID;
const defaultAuthority = `${DEFAULT_CIAM_AUTHORITY_HOST}/${tenantId}`;
const authority = readAuthority(import.meta.env.VITE_AZURE_CIAM_AUTHORITY, defaultAuthority);
const fallbackKnownAuthorities =
  authority === defaultAuthority ? DEFAULT_CIAM_KNOWN_AUTHORITIES : [new URL(authority).host];
const knownAuthorities = readKnownAuthorities(
  import.meta.env.VITE_AZURE_CIAM_KNOWN_AUTHORITIES,
  fallbackKnownAuthorities
);

export const msalConfig: Configuration = {
  auth: {
    clientId,
    authority,
    // Tell MSAL the external tenant host(s) are valid authorities.
    knownAuthorities,
    redirectUri: `${window.location.origin}/auth/callback`,
    postLogoutRedirectUri: window.location.origin + "/login",
  },
  cache: {
    cacheLocation: "localStorage",
  },
};

// Scopes requested on every sign-in.
// "openid" and "profile" are always included by MSAL; list any additional
// API scopes your backend requires here (e.g. api://<clientId>/access_as_user).
export const loginRequest: PopupRequest = {
  scopes: ["openid", "profile", "email"],
};

// CIAM supports `prompt=create` to open account creation for external users.
export const signupRequest: PopupRequest = {
  ...loginRequest,
  prompt: "create",
};
