# CIAM Microsoft Account OIDC

This runbook captures the tenant-side configuration required to let AutoFlow
customers sign in with personal Microsoft accounts through the CIAM tenant.

Related issues:

- [ALT-1839](/ALT/issues/ALT-1839) — choose the Microsoft-account auth path
- [ALT-1840](/ALT/issues/ALT-1840) — configure Microsoft Account OIDC in CIAM

## What Terraform owns

Terraform now owns the CIAM-tenant application registrations under
`infra/azure/modules/entra-ciam`:

- `autoflow-dashboard` as a workforce-only CIAM app (`AzureADMyOrg`)
- `autoflow-msa-federation` as the multitenant+personal OIDC client

The `autoflow-msa-federation` app emits these redirect URIs by default:

- `https://autoflowciam.ciamlogin.com/<tenant-guid>/federation/oauth2`
- `https://autoflowciam.ciamlogin.com/autoflowciam.onmicrosoft.com/federation/oauth2`

It also configures the `family_name` and `given_name` optional ID-token claims.

## What Graph still owns

The CIAM custom OIDC identity provider and the user-flow attachment are still
managed through Microsoft Graph, not the `azuread` provider. Use the script
below after `terraform apply` returns the Microsoft-account client ID and
secret.

## Prerequisites

- `CIAM_TENANT_ID`
- `CIAM_CLIENT_ID`
- `CIAM_CLIENT_SECRET`
- `MSA_FEDERATION_CLIENT_ID`
- `MSA_FEDERATION_CLIENT_SECRET`
- Optional: `TARGET_USER_FLOW_NAME=AutoFlow` or `TARGET_USER_FLOW_ID=<guid>`

The Graph application behind `CIAM_CLIENT_ID` needs:

- `Application.ReadWrite.All`
- `IdentityProvider.ReadWrite.All`
- `EventListener.ReadWrite.All`

## Apply the tenant-side OIDC provider

Run from the repo root:

```bash
cd infra/azure/scripts

CIAM_TENANT_ID=<tenant-guid> \
CIAM_CLIENT_ID=<graph-client-id> \
CIAM_CLIENT_SECRET=<graph-client-secret> \
MSA_FEDERATION_CLIENT_ID=<terraform-output-client-id> \
MSA_FEDERATION_CLIENT_SECRET=<terraform-output-client-secret> \
TARGET_USER_FLOW_NAME=AutoFlow \
./configure-ciam-microsoft-account-oidc.sh
```

## Verification

Success means all three checks pass:

1. `https://graph.microsoft.com/beta/identity/identityProviders` shows a custom
   OIDC provider with display name `Microsoft Account`
2. The target user flow lists that provider under:
   `identity/authenticationEventsFlows/<flow>/.../identityProviders`
3. The AutoFlow login page offers Microsoft-account sign-in and completes an
   authorization-code redirect through CIAM

## Operational notes

- The script is idempotent for the provider object and the flow attachment.
- Rotating the federation client secret requires rerunning the script so the
  tenant-side OIDC provider receives the new secret.
- Keep the Terraform and Graph steps separate until Microsoft ships stable CIAM
  OIDC-provider coverage in a Terraform provider.
