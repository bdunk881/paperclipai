# CIAM Native Auth SSPR

This runbook captures the tenant-side configuration required for Microsoft
Entra External ID native authentication password reset to work for AutoFlow.

Related issues:

- [ALT-1825](/ALT/issues/ALT-1825) — production signup and password reset errors
- [ALT-1827](/ALT/issues/ALT-1827) — enable SSPR for native auth in the CIAM tenant

## Problem signature

Native auth calls to `resetpassword/v1.0/start` fail with:

```text
AADSTS500222: The tenant or user does not support native credential recovery.
```

When this appears, the application code is usually fine. The missing dependency
is tenant-side Email OTP self-service password reset (SSPR).

Microsoft documents this prerequisite in:

- `Enable self-service password reset - Microsoft Entra External ID` (updated February 27, 2026)
- `Native authentication API reference documentation - Microsoft identity platform` (updated March 2026)

## Prerequisites

- External tenant ID in `CIAM_TENANT_ID`
- Tenant subdomain in `CIAM_TENANT_SUBDOMAIN`
- Microsoft Graph app credentials with `Policy.ReadWrite.AuthenticationMethod`
  in `CIAM_CLIENT_ID` and `CIAM_CLIENT_SECRET`
- AutoFlow CIAM SPA app client ID in `TARGET_APP_CLIENT_ID`
- A real customer email to test in `CIAM_TEST_USERNAME`

## Enablement

Run from the repo root:

```bash
cd infra/azure/scripts

CIAM_TENANT_ID=<tenant-guid> \
CIAM_CLIENT_ID=<graph-client-id> \
CIAM_CLIENT_SECRET=<graph-client-secret> \
./enable-ciam-native-auth-sspr.sh
```

If the tenant should scope Email OTP to a specific group instead of the default
target set, also pass:

```bash
CIAM_SSPR_INCLUDE_GROUP_ID=<group-guid>
```

## Verification

Verify that native auth now returns a continuation token instead of
`AADSTS500222`:

```bash
cd infra/azure/scripts

CIAM_TENANT_ID=<tenant-guid> \
CIAM_TENANT_SUBDOMAIN=<tenant-subdomain> \
TARGET_APP_CLIENT_ID=<spa-client-id> \
CIAM_TEST_USERNAME=<existing-customer-email> \
./verify-ciam-native-auth-sspr.sh
```

Success condition:

- `resetpassword/v1.0/start` returns JSON containing `continuation_token`

Failure conditions:

- `AADSTS500222` still appears: tenant SSPR policy is still disabled or not
  targeted correctly
- another API error appears: inspect the returned payload for app ID, username,
  or tenant mismatch

## Operational notes

- This setting is tenant configuration, not app code.
- Keep the enablement scripted so we do not rely on portal-only memory during
  future tenant rebuilds or environment replication.
- If Microsoft changes the Graph policy surface, update the script and keep this
  runbook aligned with the new API path.
