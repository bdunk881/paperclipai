import { Configuration, PopupRequest } from "@azure/msal-browser";

// Entra External ID (CIAM) uses the ciamlogin.com authority endpoint.
// Tenant config can be overridden via env vars in .env.local (dev) or Vercel (prod):
//   VITE_AZURE_CIAM_TENANT_SUBDOMAIN — e.g. "autoflowciam" → autoflowciam.ciamlogin.com
//   VITE_AZURE_CIAM_TENANT_DOMAIN    — optional, e.g. "autoflowciam.onmicrosoft.com"

// autoflow-dashboard app registration (recreated 2026-04-17, ALT-1257)
const DEFAULT_CIAM_CLIENT_ID = "2dfd3a08-277c-4893-b07d-eca5ae322310";
const DEFAULT_CIAM_TENANT_SUBDOMAIN = "autoflowciam";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBDOMAIN_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

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
  if (!normalized) return DEFAULT_CIAM_CLIENT_ID;
  if (!UUID_REGEX.test(normalized)) {
    console.warn("[MSAL] Invalid VITE_AZURE_CLIENT_ID format. Using built-in CIAM default.");
    return DEFAULT_CIAM_CLIENT_ID;
  }
  return normalized;
}

function readTenantSubdomain(value: string | undefined): string {
  const normalized = readNonEmptyEnv(value);
  if (!normalized) return DEFAULT_CIAM_TENANT_SUBDOMAIN;
  const clean = normalized.toLowerCase();
  if (!SUBDOMAIN_LABEL_REGEX.test(clean)) {
    console.warn(
      "[MSAL] Invalid VITE_AZURE_TENANT_SUBDOMAIN format. Using built-in CIAM default."
    );
    return DEFAULT_CIAM_TENANT_SUBDOMAIN;
  }
  return clean;
}

const clientId = readClientId(import.meta.env.VITE_AZURE_CLIENT_ID as string | undefined);
const tenantSubdomain = readTenantSubdomain(
  import.meta.env.VITE_AZURE_TENANT_SUBDOMAIN as string | undefined
);
const tenantDomain = `${tenantSubdomain}.onmicrosoft.com`;

if (
  !readNonEmptyEnv(import.meta.env.VITE_AZURE_CLIENT_ID as string | undefined) ||
  !readNonEmptyEnv(import.meta.env.VITE_AZURE_TENANT_SUBDOMAIN as string | undefined)
) {
  console.warn(
    "[MSAL] VITE_AZURE_CLIENT_ID or VITE_AZURE_TENANT_SUBDOMAIN is not set. " +
      "Using built-in CIAM defaults."
  );
}

export const msalConfig: Configuration = {
  auth: {
    clientId,
    // Entra External ID CIAM authority must include tenant domain path segment.
    authority: `https://${tenantSubdomain ?? "placeholder"}.ciamlogin.com/${tenantDomain ?? "placeholder.onmicrosoft.com"}`,
    // Tell MSAL the external tenant is a valid authority (required for non-login.microsoftonline.com authorities)
    knownAuthorities: [`${tenantSubdomain ?? "placeholder"}.ciamlogin.com`],
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
