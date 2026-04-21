import { Configuration, PopupRequest } from "@azure/msal-browser";

// Entra External ID (CIAM) uses the ciamlogin.com authority endpoint.
// Tenant config can be overridden via env vars in .env.local (dev) or Vercel (prod):
//   VITE_AZURE_CIAM_TENANT_SUBDOMAIN — e.g. "autoflowciam" → autoflowciam.ciamlogin.com
//   VITE_AZURE_CIAM_TENANT_DOMAIN    — optional, e.g. "autoflowciam.onmicrosoft.com"

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
    // Entra External ID CIAM authority must include tenant domain path segment.
    authority: `https://${tenantSubdomain}.ciamlogin.com/${tenantDomain}`,
    // Tell MSAL the external tenant is a valid authority (required for non-login.microsoftonline.com authorities)
    knownAuthorities: [`${tenantSubdomain}.ciamlogin.com`],
    redirectUri: window.location.origin,
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
