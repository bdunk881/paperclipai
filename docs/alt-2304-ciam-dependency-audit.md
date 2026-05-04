# ALT-2304 Phase 0 - CIAM Dependency Audit

This audit covers the `paperclipai` repository search requested in [ALT-2304](/ALT/issues/ALT-2304) for these patterns:

- `ciamlogin.com`
- `AZURE_CIAM_`
- `native-auth`
- `MSAL`
- `social-auth`
- `redirectUri`
- `tenantId`

Excluded from the audit:

- `paperclipai-alt1491/` because it is a side copy, not the active repo.
- `skills/` because those are local agent skills, not application/runtime code.

## Backend runtime auth

| File | Patterns found | Note |
| --- | --- | --- |
| `.env.example` | `ciamlogin.com`, `AZURE_CIAM_`, `native-auth` | Backend CIAM env contract: authority, tenant IDs, allowed audiences, and native-auth proxy rate-limit settings. |
| `src/auth/authMiddleware.ts` | `ciamlogin.com`, `AZURE_CIAM_`, `tenantId` | Main API JWT verifier for Entra External ID tokens; builds issuer and JWKS URLs from CIAM env and maps `tid` into request auth context. |
| `src/auth/authMiddleware.test.ts` | `ciamlogin.com`, `AZURE_CIAM_` | Regression coverage for CIAM issuer/JWKS resolution, legacy env fallbacks, and allowed audience behavior. |
| `src/auth/nativeAuthProxyRoutes.ts` | `ciamlogin.com`, `AZURE_CIAM_`, `native-auth`, `tenantId` | Express native-auth proxy that validates upstream CIAM hosts, resolves proxy base URLs, and forwards native-auth API traffic. |
| `src/auth/nativeAuthProxyRoutes.test.ts` | `ciamlogin.com`, `AZURE_CIAM_`, `native-auth` | Coverage for proxy routing, fallback authority resolution, allowed paths, and request/response logging. |
| `src/secrets/keyVaultSecrets.ts` | `AZURE_CIAM_` | Maps Key Vault secret `entra-client-secret` into `AZURE_CIAM_CLIENT_SECRET` runtime env. |

## Backend adjacent auth plumbing

| File | Patterns found | Note |
| --- | --- | --- |
| `src/auth/appAuthTokens.ts` | `redirectUri` | Shared JWT/state helper for social-auth redirect state; not CIAM-specific, but it is auth redirect plumbing that Phase 2 should review. |
| `src/auth/socialAuthRoutes.ts` | `redirectUri` | Passport-based social-auth start/callback routes; stores requested dashboard redirect targets and returns users to the dashboard. |
| `src/auth/socialAuthRoutes.test.ts` | `redirectUri` | Test coverage for social-auth callback redirects and redirect allowlist behavior. |

## Dashboard runtime auth

| File | Patterns found | Note |
| --- | --- | --- |
| `dashboard/.env.example` | `AZURE_CIAM_` | Dashboard CIAM env contract for Vite tenant/client config. |
| `dashboard/src/auth/msalConfig.ts` | `ciamlogin.com`, `AZURE_CIAM_`, `MSAL`, `redirectUri` | Core MSAL configuration: authority, known authorities, client ID pinning, and `/auth/callback` redirect URI. |
| `dashboard/src/auth/msalConfig.test.ts` | `ciamlogin.com`, `AZURE_CIAM_`, `MSAL`, `redirectUri` | Coverage for tenant subdomain/domain parsing and final MSAL authority/redirect URI output. |
| `dashboard/src/auth/msalInstance.ts` | `MSAL` | Singleton MSAL bootstrap and redirect result handling for the SPA. |
| `dashboard/src/auth/msalInstance.test.ts` | `MSAL`, `tenantId` | Coverage for MSAL initialization and active-account restore behavior. |
| `dashboard/src/main.tsx` | `MSAL` | App bootstrap waits for MSAL initialization before rendering the dashboard. |
| `dashboard/src/pages/Login.tsx` | `MSAL`, `tenantId` | Main login UI for Microsoft popup auth plus native-auth email/password, signup, and reset flows; persists `tenantId` in session. |
| `dashboard/src/pages/Login.test.tsx` | `MSAL`, `tenantId` | Coverage for login-page MSAL startup, popup error handling, and session shaping. |
| `dashboard/src/auth/nativeAuthClient.ts` | `native-auth`, `tenantId` | Browser client for native-auth endpoints; exchanges continuation tokens and derives the stored user session from token claims. |
| `dashboard/src/auth/nativeAuthClient.test.ts` | `AZURE_CIAM_` | Coverage for CIAM-scoped native-auth client behavior and token/session shaping. |
| `dashboard/api/auth/native/[...path].ts` | `ciamlogin.com`, `AZURE_CIAM_`, `native-auth`, `tenantId` | Vercel-side native-auth proxy that forwards approved CIAM native-auth paths to `ciamlogin.com`. |
| `dashboard/api/auth/native/[...path].test.ts` | `AZURE_CIAM_`, `native-auth` | Coverage for Vercel native-auth proxy env resolution and request/response logging. |
| `dashboard/src/auth/authStorage.ts` | `tenantId` | Local session persistence includes `tenantId` on the stored authenticated user. |
| `dashboard/src/auth/authStorage.test.ts` | `tenantId` | Coverage for session serialization/deserialization with optional tenant IDs. |
| `dashboard/src/context/AuthContext.tsx` | `tenantId` | React auth context surfaces the stored `tenantId` to dashboard consumers. |
| `dashboard/src/context/AuthContext.test.tsx` | `tenantId` | Coverage for auth context user/session hydration. |
| `dashboard/src/App.tsx` | `tenantId` | Top-level app auth types still model `tenantId` on the signed-in user. |
| `dashboard/src/App.test.tsx` | `MSAL` | App-level test mocks the MSAL browser/react providers. |
| `dashboard/src/vite-env.d.ts` | `AZURE_CIAM_` | Type declarations for Vite CIAM env vars. |
| `dashboard/e2e/helpers/auth.ts` | `native-auth` | E2E helper reads both legacy `autoflow_user` and newer native-auth session storage keys. |
| `dashboard/staticwebapp.config.template.json` | `ciamlogin.com` | Static Web Apps CSP allowlist explicitly permits `*.ciamlogin.com` and Microsoft login endpoints. |
| `dashboard/vercel.json` | `ciamlogin.com` | Vercel CSP allowlist also permits `*.ciamlogin.com` and Microsoft login endpoints. |
| `dashboard/package.json` | `MSAL` | Declares `@azure/msal-browser` and `@azure/msal-react` as runtime dependencies. |
| `dashboard/package-lock.json` | `MSAL` | Locks the transitive MSAL dependency graph used by the dashboard build. |

## Infra and provisioning

| File | Patterns found | Note |
| --- | --- | --- |
| `infra/README.md` | `ciamlogin.com`, `AZURE_CIAM_`, `native-auth` | Top-level infra operator guidance for dashboard CIAM env vars and native-auth runbooks. |
| `infra/azure/README.md` | `ciamlogin.com`, `AZURE_CIAM_`, `native-auth`, `MSAL`, `social-auth` | Azure deployment playbook covering CIAM runtime env, native-auth rollout, redirect transitions, and social-auth/provider setup. |
| `infra/azure/modules/entra-ciam/variables.tf` | `ciamlogin.com` | Terraform variable descriptions for the CIAM tenant subdomain. |
| `infra/azure/modules/entra-ciam/main.tf` | `ciamlogin.com` | Terraform module builds CIAM federation URLs and related tenant resources. |
| `infra/azure/modules/entra-ciam/outputs.tf` | `ciamlogin.com` | Terraform output describes the CIAM authority hostname/subdomain. |
| `infra/azure/variables.tf` | `ciamlogin.com` | Shared Azure variable descriptions reference the CIAM tenant subdomain and authority host. |
| `infra/azure/scripts/provision-ciam.sh` | `native-auth`, `redirectUri` | Bootstrap script that creates the Entra External ID SPA app registration and seeds its redirect URI set. |
| `infra/azure/scripts/sync-ciam-redirect-uris.sh` | `MSAL`, `redirectUri` | Graph automation that keeps the dashboard CIAM SPA redirect URIs aligned with current MSAL routes and preview hosts. |
| `infra/azure/scripts/enable-ciam-native-auth-sspr.sh` | `native-auth` | Enables Email OTP self-service password reset for native-auth users in the CIAM tenant. |
| `infra/azure/scripts/verify-ciam-native-auth-sspr.sh` | `ciamlogin.com`, `native-auth` | Smoke test that calls the CIAM `resetpassword` native-auth endpoint directly. |
| `infra/azure/scripts/grant-ciam-graph-policy-write.sh` | `native-auth` | Graph permission helper tied to the native-auth SSPR enablement workflow. |
| `infra/azure/scripts/grant-ciam-policy-admin-consent.sh` | `tenantId` | Azure admin-consent helper that reads the current tenant ID during CIAM permission setup. |

## Runbooks and docs

| File | Patterns found | Note |
| --- | --- | --- |
| `infra/runbooks/production-api-ingress.md` | `ciamlogin.com`, `AZURE_CIAM_`, `native-auth` | Production ingress runbook documents the backend CIAM runtime env and native-auth health probe. |
| `infra/runbooks/staging-key-vault-container-apps.md` | `AZURE_CIAM_` | Staging secret/bootstrap runbook references the CIAM client secret needed by the backend. |
| `infra/runbooks/swa-dashboard-deploy.md` | `MSAL` | SWA deploy checklist still references `/auth/callback` for MSAL redirect handling. |
| `infra/runbooks/ciam-native-auth-sspr.md` | `native-auth` | Operator runbook for enabling and verifying native-auth self-service password reset. |
| `infra/runbooks/ciam-microsoft-account-oidc.md` | `ciamlogin.com` | OIDC federation runbook documents CIAM federation endpoints on the tenant host. |
| `infra/runbooks/production-auth-edge-decommission.md` | `ciamlogin.com` | Migration runbook notes that production auth traffic still terminates on `*.ciamlogin.com`. |

## Phase 2b deletion checklist seeds

- Remove backend CIAM env vars, issuer/JWKS construction, and native-auth proxy code in `src/auth/authMiddleware.ts` and `src/auth/nativeAuthProxyRoutes.ts`.
- Replace dashboard MSAL bootstrap, config, and popup login flows in `dashboard/src/auth/msalConfig.ts`, `dashboard/src/auth/msalInstance.ts`, `dashboard/src/main.tsx`, and `dashboard/src/pages/Login.tsx`.
- Delete the Vercel-side native-auth proxy in `dashboard/api/auth/native/[...path].ts`.
- Remove CIAM-specific CSP allowlist entries from `dashboard/staticwebapp.config.template.json` and `dashboard/vercel.json`.
- Remove CIAM provisioning and runbook assets under `infra/azure/` and `infra/runbooks/` once Supabase Auth replaces the tenant-managed flow.
- Review adjacent redirect-state helpers in `src/auth/appAuthTokens.ts` and `src/auth/socialAuthRoutes.ts` separately; they are auth-callback infrastructure, but not direct CIAM runtime dependencies.
