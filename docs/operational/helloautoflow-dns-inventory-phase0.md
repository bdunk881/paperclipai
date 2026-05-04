# ALT-2307 Phase 0 DNS Inventory for `helloautoflow.com`

Generated from the live Cloudflare zone on 2026-05-04 UTC using the Cloudflare API.

## Summary

- Total records exported: 29
- Azure-backed application endpoints still present:
  - `api.helloautoflow.com` -> `20.75.59.207`
  - `staging-api.helloautoflow.com` -> `ca-autoflow-staging-backend.blackplant-e4a41b70.eastus2.azurecontainerapps.io`
  - `asuid.api.helloautoflow.com` and `asuid.staging-api.helloautoflow.com` TXT ownership records for Azure custom-domain binding
- Vercel-backed frontend endpoints:
  - `helloautoflow.com`
  - `www.helloautoflow.com`
  - `staging.helloautoflow.com`
  - `app.helloautoflow.com`
  - `staging.app.helloautoflow.com`
- Cloudflare-managed service endpoints:
  - `cdn.helloautoflow.com` -> Cloudflare R2 custom domain
  - `paperclip.helloautoflow.com` -> Cloudflare Tunnel hostname
- Non-app dependencies present in DNS:
  - Microsoft 365 mail/autodiscover/device enrollment
  - Amazon SES mail for `send.helloautoflow.com`
  - `track.helloautoflow.com` -> Aplonet
- Gap to verify:
  - No `docs.helloautoflow.com` record exists in this zone export, even though repo content links to that hostname.

## Records

| Type | Name | Value | TTL | Current target | Azure dependency | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| A | `api.helloautoflow.com` | `20.75.59.207` | `120` | Azure public ingress IP for production API | Yes | Production backend hostname; repo runbook treats this as the intended production API entrypoint. Also backs API routes used for OAuth callbacks, Stripe webhooks, and MCP endpoints. |
| A | `helloautoflow.com` | `76.76.21.21` | Auto | Vercel apex IP | No | Production marketing site apex. |
| CNAME | `5053c1fde250c49a59904d0afe2122a0.helloautoflow.com` | `validation.aikido.027590fbf36b4266e357946d32f8d23a` | Auto | Aikido validation record | No | Third-party verification record. |
| CNAME | `app.helloautoflow.com` | `da5eacc881226353.vercel-dns-017.com` | `600` | Vercel dashboard production alias | No | User-facing dashboard host. CIAM redirect URIs reference this hostname. |
| CNAME | `autodiscover.helloautoflow.com` | `autodiscover.outlook.com` | Auto | Microsoft 365 | No | Mail client autodiscovery. |
| CNAME | `cdn.helloautoflow.com` | `public.r2.dev` | Auto | Cloudflare R2 custom domain | No | Brand asset CDN. Proxied through Cloudflare. |
| CNAME | `enterpriseenrollment.helloautoflow.com` | `enterpriseenrollment-s.manage.microsoft.com` | Auto | Microsoft device management | No | Endpoint for enterprise enrollment. |
| CNAME | `enterpriseregistration.helloautoflow.com` | `enterpriseregistration.windows.net` | Auto | Microsoft device registration | No | Endpoint for enterprise registration. |
| CNAME | `paperclip.helloautoflow.com` | `46ddcef7-6f5b-4bac-9237-87ce7eac1caf.cfargotunnel.com` | Auto | Cloudflare Tunnel | No | Paperclip control-plane/tunnel hostname; proxied through Cloudflare. |
| CNAME | `selector1._domainkey.helloautoflow.com` | `selector1-helloautoflow-com._domainkey.duncanfamilyxyz.y-v1.dkim.mail.microsoft` | Auto | Microsoft 365 DKIM | No | Mail signing. |
| CNAME | `selector2._domainkey.helloautoflow.com` | `selector2-helloautoflow-com._domainkey.duncanfamilyxyz.y-v1.dkim.mail.microsoft` | Auto | Microsoft 365 DKIM | No | Mail signing. |
| CNAME | `staging-api.helloautoflow.com` | `ca-autoflow-staging-backend.blackplant-e4a41b70.eastus2.azurecontainerapps.io` | `120` | Azure Container Apps staging backend | Yes | Staging backend hostname. Used by staging dashboard rewrites and social-auth callback base URL. |
| CNAME | `staging.app.helloautoflow.com` | `cname.vercel-dns.com` | Auto | Vercel staging dashboard alias | No | Staging dashboard host. CIAM redirect URIs reference this hostname. |
| CNAME | `staging.helloautoflow.com` | `cname.vercel-dns.com` | Auto | Vercel staging landing alias | No | Staging marketing host. |
| CNAME | `track.helloautoflow.com` | `thankful-hound.aplonet.com` | `3600` | Aplonet tracking endpoint | No | Non-core third-party tracking hostname. |
| CNAME | `www.helloautoflow.com` | `cname.vercel-dns.com` | Auto | Vercel www alias | No | Redirect/alias for marketing site. |
| MX | `helloautoflow.com` | `helloautoflow-com.mail.protection.outlook.com` | Auto | Microsoft 365 inbound mail | No | Primary MX for root domain. |
| MX | `send.helloautoflow.com` | `feedback-smtp.us-east-1.amazonses.com` | Auto | Amazon SES | No | SES mail domain. |
| TXT | `asuid.api.helloautoflow.com` | `89826FB27B87720068B3574A49C3898CD8DDB452B2F3974F2138948F3CA226F4` | `120` | Azure App Service/Container Apps domain ownership | Yes | Required for Azure custom-domain binding of `api`. Remove only after API host is moved off Azure and binding is retired. |
| TXT | `asuid.staging-api.helloautoflow.com` | `89826FB27B87720068B3574A49C3898CD8DDB452B2F3974F2138948F3CA226F4` | `120` | Azure App Service/Container Apps domain ownership | Yes | Required for Azure custom-domain binding of `staging-api`. Remove only after staging API cutover off Azure. |
| TXT | `_dmarc.helloautoflow.com` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@helloautoflow.com` | Auto | DMARC policy | No | Mail protection policy. |
| TXT | `_dnsauth.app.helloautoflow.com` | `_dvjf13tu1c5h1toae2ef7vpai2f198r` | `300` | Domain verification token | No | Verification record for app hostname. Keep unless replaced by new provider validation flow. |
| TXT | `_dnsauth.auth.helloautoflow.com` | `_hq1b7fb7m0d2txl5r13i6t2gse221sh` | `3600` | Domain verification token | No | Indicates an `auth.helloautoflow.com` custom-domain workflow exists or was prepared, but no active `auth` host record is in this zone export. |
| TXT | `helloautoflow.com` | `v=spf1 include:spf.protection.outlook.com include:amazonses.com ~all` | Auto | SPF policy | No | Permits Microsoft 365 and SES senders. |
| TXT | `helloautoflow.com` | `MS=ms16697336` | `3600` | Microsoft verification | No | Tenant/domain ownership verification. |
| TXT | `resend._domainkey.helloautoflow.com` | DKIM public key | Auto | Resend DKIM | No | Mail signing for Resend. |
| TXT | `send.helloautoflow.com` | `v=spf1 include:amazonses.com ~all` | Auto | SES SPF policy | No | SPF for SES mail subdomain. |
| TXT | `_vercel.helloautoflow.com` | `vc-domain-verify=app.helloautoflow.com,...` | `600` | Vercel domain verification | No | Verification record for dashboard production custom domain. |
| TXT | `_vercel.helloautoflow.com` | `vc-domain-verify=staging.app.helloautoflow.com,...` | `600` | Vercel domain verification | No | Verification record for dashboard staging custom domain. |

## Migration-critical endpoints

### Azure resources that must move before Azure destroy

- `api.helloautoflow.com`
- `staging-api.helloautoflow.com`
- `asuid.api.helloautoflow.com`
- `asuid.staging-api.helloautoflow.com`

### Webhook, OAuth, and MCP-relevant hosts

- `api.helloautoflow.com`
  - Production API host for backend routes including `/api/webhooks/stripe`.
  - Natural production base for OAuth callback routes such as `/api/integrations/*/oauth/callback` and `/api/auth/social/*/callback`.
  - Dashboard clients call backend APIs through this host, including `/api/mcp/servers`.
- `staging-api.helloautoflow.com`
  - Staging API host for `/api/auth/social/google/callback` and other backend callback routes.
  - Staging dashboard rewrites route `/api/*` here.
- `app.helloautoflow.com`
  - Production dashboard hostname included in CIAM redirect/login URIs.
- `staging.app.helloautoflow.com`
  - Staging dashboard hostname included in CIAM redirect/login URIs.
- `paperclip.helloautoflow.com`
  - Paperclip tunnel hostname; not an MCP endpoint in repo code, but still an operational control-plane hostname to preserve if the tunnel remains in use.

## Follow-up notes

- `docs.helloautoflow.com` is referenced in repo content, but no DNS record for that hostname exists in the `helloautoflow.com` zone export captured here.
- The frontend surface is already largely on Vercel; the backend cutover risk is concentrated in the Azure-backed API hosts.
- Mail and device-management records are unrelated to app hosting and should be excluded from any Azure teardown checklist unless the corresponding external services are also being retired.
