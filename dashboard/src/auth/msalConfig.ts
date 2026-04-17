import { Configuration, PopupRequest } from "@azure/msal-browser";

// Entra External ID (CIAM) uses the ciamlogin.com authority endpoint.
// Override via env vars in .env.local (dev) or Vercel (prod):
//   VITE_AZURE_CIAM_CLIENT_ID        — CIAM app registration client ID
//   VITE_AZURE_CIAM_TENANT_SUBDOMAIN — e.g. "autoflowciam" → autoflowciam.ciamlogin.com
//   VITE_AZURE_CIAM_TENANT_DOMAIN    — optional, e.g. "autoflowciam.onmicrosoft.com"

// autoflow-dashboard app registration (recreated 2026-04-17, ALT-1257)
const DEFAULT_CIAM_CLIENT_ID = "2dfd3a08-277c-4893-b07d-eca5ae322310";
const DEFAULT_CIAM_TENANT_SUBDOMAIN = "autoflowciam";
const DEFAULT_CIAM_TENANT_DOMAIN = "autoflowciam.onmicrosoft.com";
const EMPTY_CLIENT_ID = "00000000-0000-0000-0000-000000000000";

const configuredClientId = import.meta.env.VITE_AZURE_CIAM_CLIENT_ID?.trim();
const configuredTenantSubdomain = import.meta.env.VITE_AZURE_CIAM_TENANT_SUBDOMAIN?.trim();
const configuredTenantDomain = import.meta.env.VITE_AZURE_CIAM_TENANT_DOMAIN?.trim();

if (!configuredClientId || !configuredTenantSubdomain) {
  console.warn(
    "[MSAL] Missing CIAM env vars; using AutoFlow defaults. " +
      "Set VITE_AZURE_CIAM_CLIENT_ID and VITE_AZURE_CIAM_TENANT_SUBDOMAIN in environment."
  );
}

const clientId = configuredClientId || DEFAULT_CIAM_CLIENT_ID;
const tenantSubdomain = configuredTenantSubdomain || DEFAULT_CIAM_TENANT_SUBDOMAIN;
const tenantDomain =
  configuredTenantDomain ||
  (tenantSubdomain ? `${tenantSubdomain}.onmicrosoft.com` : DEFAULT_CIAM_TENANT_DOMAIN);

if (clientId === EMPTY_CLIENT_ID) {
  console.warn(
    "[MSAL] CIAM client ID is set to the all-zero placeholder. " +
      "Update VITE_AZURE_CIAM_CLIENT_ID with the real app registration client ID."
  );
}

export const msalConfig: Configuration = {
  auth: {
    clientId: clientId || DEFAULT_CIAM_CLIENT_ID,
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
