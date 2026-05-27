# Admin Console — setup and operations

This document covers everything needed to stand up the platform admin console
(admin.helloautoflow.com) and grant the first staff member.

## Architecture

- **Frontend** lives in `admin/` and deploys to Cloudflare Pages via
  `.github/workflows/admin-cloudflare-pages.yml`. Custom domain:
  `admin.helloautoflow.com` (prod) / `admin-dev.helloautoflow.com` (dev).
- **Backend** lives under `src/adminConsole/` and is mounted at
  `/api/admin-console/*` from `src/app.ts`. The public impersonation-verify
  endpoint is at `/api/impersonation/verify` (NOT under the admin gate).
- **Audit log** is `platform_admin_audit_log` (migration 059) — cross-tenant,
  append-only at the RLS level.
- **Cross-tenant reads** go through the SECURITY DEFINER lookup functions in
  migration 060; they gate on the session GUC `app.is_platform_admin`.

## Required environment variables

### API (Fly)
| Name | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL (same as the customer dashboard). |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key. **Only set on the API; never on the frontend.** Required for password-reset link gen, MFA factor wipe, sign-out-all-sessions. |
| `IMPERSONATION_TOKEN_SECRET` | ≥ 32-char random secret. Signs impersonation tokens. Rotating it invalidates all in-flight sessions. |
| `AUTOFLOW_STAFF_USER_IDS` | (optional, bootstrap only) comma-separated user IDs treated as platform admin even without the DB flag. Use to bootstrap the first admin. |
| `ADMIN_RATE_LIMIT_*` | (optional) Override the default per-admin rate limits. See `src/adminConsole/rateLimit.ts`. |

### Admin app (Cloudflare Pages, via Infisical)
| Name | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Same as dashboard. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Same as dashboard. |
| `VITE_API_BASE_URL` | `https://api.helloautoflow.com` (or dev equivalent). |
| `VITE_DASHBOARD_ORIGIN` | `https://app.helloautoflow.com` (origin of the customer dashboard used by the "Open dashboard as user" link). |

## Granting the first platform admin

There is no UI for granting `is_platform_admin` — it must be done via psql.

```sql
-- Find the user's id from the email
SELECT id FROM auth.users WHERE email = 'staff@helloautoflow.com';

-- Upsert their profile row with the flag set
INSERT INTO user_profiles (user_id, is_platform_admin)
     VALUES ($1, true)
ON CONFLICT (user_id) DO UPDATE SET is_platform_admin = true;
```

Alternatively, set the env var bootstrap on the API and the user is treated as
admin without a DB row (useful for first-time setup):

```
AUTOFLOW_STAFF_USER_IDS=<sub-of-first-staff-user>
```

## MFA requirement

Every admin route requires the JWT's `aal` claim to be `aal2` (MFA-elevated).
The admin app's `MfaGate` enforces this client-side as well — staff who haven't
enrolled a TOTP factor see only the enrollment page.

## Two-person rule

These actions queue in `pending_admin_actions` and require a different admin
to confirm within 5 minutes:

- workspace suspension (`POST /api/admin-console/workspace-ops/:id/suspend`)
- right-to-erasure delete (`POST /api/admin-console/data-hygiene/:userId/erasure`)
- (future) ownership transfer

The confirming admin opens `/pending-actions` in the admin app and clicks
Confirm. The CHECK constraint on the table blocks self-confirmation.

## Failed-login telemetry

Optional but recommended: configure a Supabase auth webhook to POST to
`/api/admin-console/abuse/_ingest/failed-login` (TODO route — wire when the
webhook is enabled) so `auth_failed_logins` and `auth_login_devices` populate.
Without the webhook, the abuse-signal tab shows empty state.

## Audit log retention

The table is append-only via RLS — UPDATE/DELETE are blocked even for
superusers. For long-term retention, mirror the table daily to R2 via the
existing `ops/` job runners (TODO: add `dump-audit-log.sh`).

## Operational runbook

- A staff member can't sign in? Check (a) `is_platform_admin` flag set;
  (b) MFA enrolled (Supabase dashboard → Authentication → Users → Factors);
  (c) JWT shows `aal: aal2` after their challenge.
- Audit log row was supposed to be written but wasn't? The handler aborted
  before reaching `recordAdminAction()` (validation failure). Re-issue with a
  valid payload.
- Impersonation token rejected even though just minted? Either the secret
  rotated, or the verifier and minter are on different deploys. Check
  `IMPERSONATION_TOKEN_SECRET` matches between API and (if you ever expose it)
  consumer.
