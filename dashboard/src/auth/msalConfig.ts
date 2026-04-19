import { Configuration, PopupRequest } from "@azure/msal-browser";

// Entra External ID (CIAM) uses the ciamlogin.com authority endpoint.
// Set these env vars in .env.local for dev and in Vercel for prod:
//   VITE_AZURE_CLIENT_ID       — App registration client ID from Azure Portal
//   VITE_AZURE_TENANT_SUBDOMAIN — Tenant subdomain (e.g. "myapp" → myapp.ciamlogin.com)

const clientId = import.meta.env.VITE_AZURE_CLIENT_ID as string;
const tenantSubdomain = import.meta.env.VITE_AZURE_TENANT_SUBDOMAIN as string;

if (!clientId || !tenantSubdomain) {
  console.warn(
    "[MSAL] VITE_AZURE_CLIENT_ID or VITE_AZURE_TENANT_SUBDOMAIN is not set. " +
      "Auth will not work until these are configured."
  );
}

export const msalConfig: Configuration = {
  auth: {
    clientId: clientId ?? "00000000-0000-0000-0000-000000000000",
    // Entra External ID CIAM authority — no trailing path segment needed
    authority: `https://${tenantSubdomain ?? "placeholder"}.ciamlogin.com/`,
    // Tell MSAL the external tenant is a valid authority (required for non-login.microsoftonline.com authorities)
    knownAuthorities: [`${tenantSubdomain ?? "placeholder"}.ciamlogin.com`],
    redirectUri: window.location.origin + "/auth/callback",
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
