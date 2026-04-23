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

## Current API credential status

The CIAM app credentials already exist and can acquire an app-only Graph token in tenant `5e4f1080-8afc-4005-b05e-32b21e69363a`:

- `CIAM_CLIENT_ID=f0c4b48e-9052-43d6-a3e6-c5c65ba18ad7`
- token tenant: `5e4f1080-8afc-4005-b05e-32b21e69363a`

Current app roles on that token:

- `Application.ReadWrite.All`
- `Application.Read.All`
- `IdentityProvider.ReadWrite.All`
- `IdentityUserFlow.ReadWrite.All`
- `Organization.Read.All`
- `Policy.ReadWrite.AuthenticationFlows`
- `Policy.ReadWrite.TrustFramework`
- `TrustFrameworkKeySet.ReadWrite.All`

Missing for the API-first path:

- `OrganizationalBranding.ReadWrite.All`
- `Domain.ReadWrite.All`

Without those permissions, we can authenticate to Graph and inspect tenant state, but we cannot update branding or create/verify custom domains through Graph.

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

### API-first equivalent

Branding is exposed through Microsoft Graph `organizationalBranding`.

Required app permission:

- `OrganizationalBranding.ReadWrite.All`

Sequence:

1. Acquire a Graph token in the CIAM tenant with `CIAM_CLIENT_ID`, `CIAM_CLIENT_SECRET`, and `CIAM_TENANT_ID`.
2. PATCH the non-binary properties on `/v1.0/organization/{tenantId}/branding`.
3. PUT the binary logo/image assets on the specific stream endpoints.

Example text update:

```bash
curl -X PATCH "https://graph.microsoft.com/v1.0/organization/5e4f1080-8afc-4005-b05e-32b21e69363a/branding" \
  -H "Authorization: Bearer $GRAPH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "backgroundColor": "#0f172a",
    "signInPageText": "Sign in to AutoFlow",
    "usernameHintText": "Email address"
  }'
```

Example banner upload:

```bash
curl -X PUT "https://graph.microsoft.com/v1.0/organization/5e4f1080-8afc-4005-b05e-32b21e69363a/branding/localizations/0/bannerLogo" \
  -H "Authorization: Bearer $GRAPH_TOKEN" \
  -H "Content-Type: image/png" \
  --data-binary @banner-logo.png
```

Notes:

- String properties use `PATCH`.
- Stream properties such as `bannerLogo`, `backgroundImage`, and `headerLogo` use `PUT`.
- Locale-specific branding can be added with `/branding/localizations`.

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

### API-first equivalent

Domain management is exposed through Microsoft Graph `domain`.

Required app permission:

- `Domain.ReadWrite.All`

Sequence:

1. `POST /v1.0/domains` with `{ "id": "auth.helloautoflow.com" }`
2. `GET /v1.0/domains/auth.helloautoflow.com/verificationDnsRecords`
3. Publish the returned TXT record in Cloudflare
4. `POST /v1.0/domains/auth.helloautoflow.com/verify`

Example create call:

```bash
curl -X POST "https://graph.microsoft.com/v1.0/domains" \
  -H "Authorization: Bearer $GRAPH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "id": "auth.helloautoflow.com" }'
```

Example verification-record lookup:

```bash
curl "https://graph.microsoft.com/v1.0/domains/auth.helloautoflow.com/verificationDnsRecords" \
  -H "Authorization: Bearer $GRAPH_TOKEN"
```

Example verify call:

```bash
curl -X POST "https://graph.microsoft.com/v1.0/domains/auth.helloautoflow.com/verify" \
  -H "Authorization: Bearer $GRAPH_TOKEN"
```

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

### API-first caveat

Microsoft’s identity/network-access docs map custom URL domains to the `domain` APIs and the `CustomUrlDomain` entry in `supportedServices`. The update call that sets `supportedServices` to include `CustomUrlDomain` is still documented on Microsoft Graph `beta`, so treat this as the risky part of a pure app-only automation flow.

Practical recommendation:

- Use Graph API for create, verification-record lookup, and verify.
- Use ARM or `az afd` for Azure Front Door creation and domain binding.
- Keep a delegated admin fallback for the final External ID custom-URL association if the beta `PATCH /beta/domains/{id}` step is blocked or unstable.

## Validation checklist

- `auth.helloautoflow.com` resolves to the Azure Front Door endpoint
- Front Door custom domain validation state is `Approved`
- User-flow authorize URL loads under `auth.helloautoflow.com`
- Branding assets appear on the hosted sign-in page
- The fallback `ciamlogin.com` host is still functional until the app authority is switched

## Current blocker in current automation

The CIAM app is present and can authenticate, but the permission set is incomplete for an API-only implementation.

Current blockers:

- no `OrganizationalBranding.ReadWrite.All`, so branding PATCH/PUT calls are blocked
- no `Domain.ReadWrite.All`, so domain create/verify calls are blocked
- the `supportedServices = ["CustomUrlDomain"]` association step remains beta-documented, so keep a delegated fallback ready

## Follow-up tickets after the domain is live

- Frontend: update `dashboard/src/auth/msalConfig.ts` so authority and `knownAuthorities` use `auth.helloautoflow.com`
- Backend: update issuer and JWKS host handling in `src/auth/authMiddleware.ts` if tokens are expected from the custom host rather than `ciamlogin.com`
- Security/ops: optionally open a Microsoft support ticket to block the default `autoflowciam.ciamlogin.com` domain after cutover
