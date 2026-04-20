import { Configuration, PopupRequest } from "@azure/msal-browser";

// Entra External ID (CIAM) uses the ciamlogin.com authority endpoint.
// Tenant config can be overridden via env vars in .env.local (dev) or Vercel (prod):
//   VITE_AZURE_CIAM_CLIENT_ID        — app registration client ID
//   VITE_AZURE_CIAM_TENANT_SUBDOMAIN — e.g. "autoflowciam" → autoflowciam.ciamlogin.com
//   VITE_AZURE_CIAM_TENANT_DOMAIN    — optional, e.g. "autoflowciam.onmicrosoft.com"

const SUBDOMAIN_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const HOSTNAME_REGEX =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readNonEmptyEnv(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.toLowerCase() === "undefined" || normalized.toLowerCase() === "null") {
    return null;
  }
  return normalized;
}

function readClientId(value: string | undefined): string {
  const normalized = readNonEmptyEnv(value);
  if (!normalized) {
    throw new Error("Missing required VITE_AZURE_CIAM_CLIENT_ID environment variable.");
  }
  if (!UUID_REGEX.test(normalized)) {
    throw new Error("Invalid VITE_AZURE_CIAM_CLIENT_ID format. Expected a GUID.");
  }
  return normalized;
}

function readTenantSubdomain(value: string | undefined): string {
  const normalized = readNonEmptyEnv(value);
  if (!normalized) {
    throw new Error("Missing required VITE_AZURE_CIAM_TENANT_SUBDOMAIN environment variable.");
  }
  const clean = normalized.toLowerCase();
  if (!SUBDOMAIN_LABEL_REGEX.test(clean)) {
    throw new Error("Invalid VITE_AZURE_CIAM_TENANT_SUBDOMAIN format.");
  }
  return clean;
}

function readTenantDomain(value: string | undefined, fallbackSubdomain: string): string {
  const normalized = readNonEmptyEnv(value);
  if (!normalized) return `${fallbackSubdomain}.onmicrosoft.com`;
  const clean = normalized.toLowerCase();
  if (!HOSTNAME_REGEX.test(clean)) {
    throw new Error("Invalid VITE_AZURE_CIAM_TENANT_DOMAIN format.");
  }
  return clean;
}

const clientId = readClientId(import.meta.env.VITE_AZURE_CIAM_CLIENT_ID);
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
