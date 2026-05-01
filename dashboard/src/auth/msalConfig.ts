import { Configuration, PopupRequest } from "@azure/msal-browser";

// Entra External ID (CIAM) uses the tenant's ciamlogin.com authority endpoint.
// Supported env vars in .env.local (dev) or Vercel (prod):
//   VITE_AZURE_CIAM_TENANT_SUBDOMAIN — optional tenant subdomain, e.g. "autoflowciam"
//   VITE_AZURE_CIAM_TENANT_DOMAIN    — optional tenant domain, e.g. "autoflowciam.onmicrosoft.com"

// autoflow-dashboard app registration (recreated 2026-04-17, ALT-1257)
const DEFAULT_CIAM_CLIENT_ID = "2dfd3a08-277c-4893-b07d-eca5ae322310";
const DEFAULT_CIAM_TENANT_SUBDOMAIN = "autoflowciam";

const SUBDOMAIN_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
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

function readTenantSubdomain(value: string | undefined): string {
  const normalized = readNonEmptyEnv(value);
  if (!normalized) return DEFAULT_CIAM_TENANT_SUBDOMAIN;
  const clean = normalized.toLowerCase();
  if (!SUBDOMAIN_LABEL_REGEX.test(clean)) {
    console.warn(
      "[MSAL] Invalid VITE_AZURE_CIAM_TENANT_SUBDOMAIN format. Using built-in CIAM default."
    );
    return DEFAULT_CIAM_TENANT_SUBDOMAIN;
  }
  return clean;
}

function readTenantDomain(value: string | undefined, fallbackSubdomain: string): string {
  const normalized = readNonEmptyEnv(value);
  if (!normalized) return `${fallbackSubdomain}.onmicrosoft.com`;
  const clean = normalized.toLowerCase();
  if (!HOSTNAME_REGEX.test(clean)) {
    console.warn("[MSAL] Invalid VITE_AZURE_CIAM_TENANT_DOMAIN format. Using derived CIAM domain.");
    return `${fallbackSubdomain}.onmicrosoft.com`;
  }
  return clean;
}

// Use defaults directly. Env var overrides are only applied for tenant
// config (subdomain/domain); the client ID is pinned to the app registration
// above to avoid stale env var overrides in Vercel.
const clientId = DEFAULT_CIAM_CLIENT_ID;
const tenantSubdomain = readTenantSubdomain(import.meta.env.VITE_AZURE_CIAM_TENANT_SUBDOMAIN);
const tenantDomain = readTenantDomain(import.meta.env.VITE_AZURE_CIAM_TENANT_DOMAIN, tenantSubdomain);

export const msalConfig: Configuration = {
  auth: {
    clientId,
    authority: `https://${tenantSubdomain}.ciamlogin.com/${tenantDomain}`,
    // Tell MSAL the external tenant is a valid authority.
    knownAuthorities: [`${tenantSubdomain}.ciamlogin.com`],
    redirectUri: `${window.location.origin}/auth/callback`,
    postLogoutRedirectUri: window.location.origin + "/login",
  },
  cache: {
    cacheLocation: "sessionStorage",
  },
};

// Scopes requested on every sign-in.
// The API scope ensures the access_token has aud = our client ID (not Graph).
export const loginRequest: PopupRequest = {
  scopes: ["openid", "profile", "email", `api://${clientId}/access_as_user`],
};

// CIAM supports `prompt=create` to open account creation for external users.
export const signupRequest: PopupRequest = {
  ...loginRequest,
  prompt: "create",
};
