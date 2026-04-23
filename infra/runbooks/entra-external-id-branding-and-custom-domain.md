# Entra External ID Branding And Custom Auth Domain

Runbook for `ALT-1648`.

## Current tenant state

- External tenant display name: `Autoflow CIAM`
- External tenant domain: `Autoflowciam.onmicrosoft.com`
- External tenant ID: `5e4f1080-8afc-4005-b05e-32b21e69363a`
- Default auth host: `autoflowciam.ciamlogin.com`
- Azure resource group: `autoflow-ciam-rg`
- DNS provider for `helloautoflow.com`: Cloudflare
- Target custom auth host: `auth.helloautoflow.com`

## Required roles and access

- Microsoft Entra external tenant:
  - `Organizational Branding Administrator` for branding updates
  - `Domain Name Administrator` for domain verification
- Azure subscription `776a7226-e364-4cd9-a3e6-d083641af9ea`:
  - `Contributor` or equivalent on the resource group that will hold Azure Front Door
- Cloudflare zone access for `helloautoflow.com`
- Tenant-local automation identity in the CIAM tenant if you want to script app-registration or branding follow-up

## Brand assets

Use the product assets already in-repo:

- Header logo: `infra/brand-assets/payload/logos/product/wordmark.svg`
- Compact icon/favicon: `infra/brand-assets/payload/logos/product/icon.svg`

If Entra rejects SVG for a specific slot, export PNG variants before upload. Keep the source assets in the paths above as the canonical brand files.

## Phase 1: Company branding

Microsoft’s current external-tenant branding flow lives in Entra admin center under `Entra ID > Custom Branding`.

1. Sign in to `https://entra.microsoft.com` and switch to tenant `Autoflow CIAM`.
2. Open `Entra ID > Custom Branding`.
3. On `Default sign-in`, configure:
   - favicon from the AutoFlow icon asset
   - background color aligned to AutoFlow brand palette
   - header logo from the AutoFlow wordmark
   - footer visibility and policy links as needed
   - sign-in text copy for AutoFlow
4. On the layout tab, upload custom CSS if needed to reduce neutral Microsoft chrome and tighten spacing.
5. Save and validate the hosted sign-in page with a user flow run URL.

Notes:

- External tenants start from neutral branding rather than workforce-tenant Microsoft branding.
- If the banner logo is omitted, the tenant name is shown instead.
- Custom CSS is supported for external-tenant branding flows documented by Microsoft Learn as of April 22, 2026.

## Phase 2: Custom auth domain

Microsoft Entra External ID custom auth domains require two layers:

1. A verified custom subdomain in the external tenant.
2. Azure Front Door in front of `<tenant>.ciamlogin.com`.

This is not just an Entra custom domain plus automatic certificate issuance.

### Step 2.1: Verify the auth subdomain in the external tenant

In the external tenant:

1. Go to `Identity > Settings > Domain names > Custom domain names`.
2. Add `auth.helloautoflow.com`.
3. Publish the TXT record Cloudflare shows for that hostname.
4. Verify the domain in Entra.
5. Remove the verification TXT record after success if Microsoft indicates it is no longer needed.

Expected DNS record during verification:

| Type | Name | Value |
| --- | --- | --- |
| TXT | `auth` | `MS=<tenant-generated-token>` |

### Step 2.2: Create Azure Front Door

Create a Standard or Premium Azure Front Door profile with:

- Origin host name: `autoflowciam.ciamlogin.com`
- Origin host header: `autoflowciam.ciamlogin.com`
- Route enabled and associated with the auth endpoint

Current repo state:

- No Azure Front Door profile exists yet in this subscription.
- No Azure DNS zone exists in this subscription for `helloautoflow.com`, so DNS stays in Cloudflare.

### Step 2.3: Point Cloudflare at Front Door

After Front Door is created, add:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | `auth` | `<front-door-endpoint>.azurefd.net` |
| TXT | `_dnsauth.auth` | `<front-door-validation-token>` |

Front Door must approve the custom domain before endpoint association is complete.

### Step 2.4: Associate the Entra custom URL domain

In the external tenant:

1. Go to `Entra ID > Domain names > Custom URL domains`.
2. Add a custom URL domain and select `auth.helloautoflow.com`.
3. Save the association.
4. Test the user flow by replacing the hostname in the run URL:

`https://auth.helloautoflow.com/5e4f1080-8afc-4005-b05e-32b21e69363a/oauth2/v2.0/authorize?...`

Using the tenant GUID removes the visible `onmicrosoft.com` path segment.

## Validation checklist

- `auth.helloautoflow.com` resolves to the Azure Front Door endpoint
- Front Door custom domain validation state is `Approved`
- User-flow authorize URL loads under `auth.helloautoflow.com`
- Branding assets appear on the hosted sign-in page
- The fallback `ciamlogin.com` host is still functional until the app authority is switched

## Known blocker in current automation

The current automation service principal is only present in workforce tenant `b1cb1311-760a-4c88-a778-5d2c227a1f45`.

It cannot get a Graph token in the CIAM tenant:

- CIAM tenant ID: `5e4f1080-8afc-4005-b05e-32b21e69363a`
- Error observed: `AADSTS700016` because the application is not found in `Autoflow CIAM`

That blocks scripted CIAM-tenant actions such as:

- app registration inside the CIAM tenant
- Graph-driven branding updates
- any automation that requires tenant-local consent

## Follow-up tickets after the domain is live

- Frontend: update `dashboard/src/auth/msalConfig.ts` so authority and `knownAuthorities` use `auth.helloautoflow.com`
- Backend: update issuer and JWKS host handling in `src/auth/authMiddleware.ts` if tokens are expected from the custom host rather than `ciamlogin.com`
- Security/ops: optionally open a Microsoft support ticket to block the default `autoflowciam.ciamlogin.com` domain after cutover
