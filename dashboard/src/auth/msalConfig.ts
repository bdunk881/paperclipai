import { Configuration, PopupRequest } from "@azure/msal-browser";

// Entra External ID (CIAM) uses the ciamlogin.com authority endpoint.
// Set these env vars in .env.local for dev and in Vercel for prod:
//   VITE_AZURE_CLIENT_ID       — App registration client ID from Azure Portal
//   VITE_AZURE_TENANT_SUBDOMAIN — Tenant subdomain (e.g. "myapp" → myapp.ciamlogin.com)
const DEFAULT_CIAM_CLIENT_ID = "2dfd3a08-277c-4893-b07d-eca5ae322310";
const DEFAULT_CIAM_TENANT_SUBDOMAIN = "autoflowciam";

const clientId =
  (import.meta.env.VITE_AZURE_CLIENT_ID as string | undefined) ??
  DEFAULT_CIAM_CLIENT_ID;
const tenantSubdomain =
  (import.meta.env.VITE_AZURE_TENANT_SUBDOMAIN as string | undefined) ??
  DEFAULT_CIAM_TENANT_SUBDOMAIN;
const tenantDomain = `${tenantSubdomain}.onmicrosoft.com`;

if (!import.meta.env.VITE_AZURE_CLIENT_ID || !import.meta.env.VITE_AZURE_TENANT_SUBDOMAIN) {
  console.warn(
    "[MSAL] VITE_AZURE_CLIENT_ID or VITE_AZURE_TENANT_SUBDOMAIN is not set. " +
      "Using built-in CIAM defaults."
  );
}

export const msalConfig: Configuration = {
  auth: {
    clientId,
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

export const signupRequest: PopupRequest = {
  scopes: ["openid", "profile", "email"],
  prompt: "create",
};
