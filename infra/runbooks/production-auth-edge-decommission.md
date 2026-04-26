# Production Auth Edge Decommission

This runbook captures the production cleanup and verification steps for removing the old branded auth edge path for `auth.helloautoflow.com`.

Related issues:

- [ALT-1773](/ALT/issues/ALT-1773) — staging decommission precedent
- [ALT-1820](/ALT/issues/ALT-1820) — CIAM auth cutover to `autoflowciam.ciamlogin.com`
- [ALT-1822](/ALT/issues/ALT-1822) — production deprovision follow-up

## Scope

Use this runbook to verify that production no longer depends on Azure Front Door, Azure CDN, or Azure-hosted DNS for the retired branded auth hostname.

## Verification commands

Run from an authenticated Azure CLI session against the production subscription:

```bash
az account show --output table

az resource list \
  --query "[?type=='Microsoft.Cdn/profiles' || type=='Microsoft.Cdn/profiles/afdendpoints' || type=='Microsoft.Cdn/profiles/customdomains' || type=='Microsoft.Network/frontDoors' || type=='Microsoft.Network/frontdoorwebapplicationfirewallpolicies'].[resourceGroup,name,type]" \
  -o table

az network dns zone list \
  --query "[].[resourceGroup,name,zoneType]" \
  -o table

dig +short auth.helloautoflow.com
nslookup auth.helloautoflow.com
```

Optional broader inventory sweep:

```bash
az resource list \
  --query "[?contains(type, 'Microsoft.Cdn') || contains(type, 'frontDoors') || contains(name, 'helloautoflow') || contains(name, 'frontdoor') || contains(name, 'auth')].[resourceGroup,name,type,location]" \
  -o table
```

## Latest verification snapshot

Verification timestamp (UTC): `2026-04-26T12:10:56Z`

Observed results:

- `az resource list` returned `0` Azure Front Door / CDN / Front Door WAF resources in subscription `776a7226-e364-4cd9-a3e6-d083641af9ea`
- `az network dns zone list` returned `0` Azure DNS zones in the same subscription
- `dig +short auth.helloautoflow.com` returned no records
- `nslookup auth.helloautoflow.com` returned `*** Can't find auth.helloautoflow.com: No answer`
- Repo search found active auth configuration pointing at `*.ciamlogin.com`, not `auth.helloautoflow.com`

Conclusion:

- No Azure-managed Front Door or CDN resource remains to deprovision in the current production subscription
- No Azure-hosted DNS zone remains for the retired branded auth hostname
- The retired hostname is no longer publicly answering DNS, so there is no live dependency on the old auth edge

## External handoff note

No Azure-side cleanup remains based on the current subscription inventory. If the registrar or DNS provider outside Azure still holds historical records for `auth.helloautoflow.com`, they can remain absent or be deleted there for hygiene, but there is no longer an Azure dependency to preserve.

## Exit criteria

This decommission is complete when all of the following stay true:

- Azure inventory remains empty for Front Door / CDN resource types
- The branded auth hostname has no public answer
- Production auth traffic continues to use `autoflowciam.ciamlogin.com`
