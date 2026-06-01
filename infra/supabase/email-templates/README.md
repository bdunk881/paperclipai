# Supabase Auth email templates

Branded HTML for the six standard Supabase Auth emails AutoFlow can send. These
files are the **source of truth**; nothing here auto-applies. You apply them to
the cloud project by pasting them into the dashboard (or via the Management API)
— see [Applying](#applying) below.

## Why these aren't Supabase's defaults

The dashboard verifies auth links **client-side**: `dashboard/src/pages/AuthConfirm.tsx`
reads `token_hash` + `type` from the URL and calls `supabase.auth.verifyOtp(...)`
at the `/auth/confirm` route. Supabase's **default** templates use
`{{ .ConfirmationURL }}`, which routes through Supabase's own `/verify` redirect
endpoint and bypasses that flow.

So every link-based template here uses the **`{{ .TokenHash }}` pattern** pointed
at `/auth/confirm`:

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<type>&next=<path>
```

Do **not** revert these to `{{ .ConfirmationURL }}` — the link would not be
verified by the dashboard. The `type` values match the `VALID_OTP_TYPES` set in
`AuthConfirm.tsx` (`signup | invite | magiclink | recovery | email_change | email`).

## Templates

| Supabase template | File | Subject | `type` | Link target |
|---|---|---|---|---|
| Confirm signup | `confirm-signup.html` | `Confirm your AutoFlow email` | `signup` | `/auth/confirm … &next=/` |
| Invite user | `invite.html` | `You're invited to AutoFlow` | `invite` | `/auth/confirm … &next=/welcome` |
| Magic Link | `magic-link.html` | `Your AutoFlow sign-in link` | `magiclink` | `/auth/confirm … &next=/` |
| Change Email Address | `change-email.html` | `Confirm your new AutoFlow email` | `email_change` | `/auth/confirm … &next=/` |
| Reset Password | `reset-password.html` | `Reset your AutoFlow password` | `recovery` | `/auth/confirm … &next=/reset-password` |
| Reauthentication | `reauthentication.html` | `Your AutoFlow verification code` | — | none — shows `{{ .Token }}` code |

The app actively triggers **Confirm signup** (`client.auth.signUp`,
`src/auth/passwordAuthRoutes.ts`) and **Reset password**
(`client.auth.resetPasswordForEmail`, same file). The others are branded and
wired so they're correct the moment those flows are enabled.

> `recovery` links route through `/auth/confirm`, which `verifyOtp`s the token
> and then redirects to `/reset-password` (`AuthConfirm.tsx`). The backend's
> `resetPasswordForEmail` `redirectTo` is `/reset-password`; the dashboard
> tolerates both the direct landing and the `/auth/confirm` hop.

> The separate **custom MFA magic-link / email-OTP** system
> (`src/security/mfaService.ts`) sends its own emails through an internal sender
> and is **not** affected by these templates.

## Required Auth URL configuration

In **Supabase Dashboard → Authentication → URL Configuration**:

- **Site URL**: `https://app.helloautoflow.com` (must match `DASHBOARD_ORIGIN`;
  `.env.example`). `{{ .SiteURL }}` in every template resolves to this.
- **Redirect URLs** (allowlist) must include:
  - `https://app.helloautoflow.com/auth/confirm`
  - `https://app.helloautoflow.com/reset-password`
  - `https://app.helloautoflow.com/welcome`

  Add the equivalent staging/preview origins as needed (e.g. a staging dashboard
  host) before testing there.

## Applying

Per environment (staging first, then production):

1. **Dashboard** → **Authentication** → **Emails** → **Templates**.
2. For each row in the table above, open that template, set the **Subject** to
   the value shown, and paste the **entire** matching `.html` file into the
   message body.
3. Save. Confirm the URL configuration above is set for that project.

Alternatively, apply via the **Management API**
(`PATCH /v1/projects/{ref}/config/auth`, fields like `mailer_subjects_*` /
`mailer_templates_*_content`) with a personal access token — useful for
scripting parity across projects.

## Supabase template variables used

| Variable | Meaning |
|---|---|
| `{{ .SiteURL }}` | The configured Site URL (dashboard origin). |
| `{{ .TokenHash }}` | Hashed OTP for the verification link (`verifyOtp`). |
| `{{ .Token }}` | 6-digit numeric code (reauthentication only). |
| `{{ .Email }}` | The user's current email address. |
| `{{ .NewEmail }}` | The requested new address (change-email only). |
| `{{ .RedirectTo }}` | The app-supplied redirect target, if used. |

## Theme & rendering notes

Templates follow the AutoFlow **v2 "Workplace"** design system
(`docs/design/v2/styles.css`) — warm editorial, light by default:

| Role | Value |
|---|---|
| Page background (paper) | `#f6f1e7` |
| Card | `#ffffff`, 12px radius, `#e3d9c2` border |
| Heading ink | `#1a1410` |
| Body text | `#6b5a48` |
| Muted / footer | `#94836e` |
| Primary CTA (clay/terracotta) | `#c2502b`, 6px radius, white text |
| Rules / borders | `#e3d9c2` |
| Display / headings + wordmark | serif: `Fraunces` → `Source Serif 4` → `Georgia` |
| Body | sans: `Geist` → `Inter` → system |
| Code (reauthentication) | mono: `JetBrains Mono` → system mono |

Implementation is the email-client-safe baseline: single `<table>` layout,
`max-width:600px`, all styles inline, web-safe font fallbacks. Email clients
won't load `Fraunces`/`Geist` web fonts, so headings render in **Georgia** (a
classic editorial serif) and body in the system sans — both intentional and
on-brand. The design stays **light** (not dark-mode) because several clients
(notably Outlook and some auto dark-mode implementations) render dark
backgrounds unpredictably.

## SMTP (follow-up, not configured here)

Supabase's **built-in** email sender is heavily rate-limited and meant for
development only. Before relying on these in production, configure **custom SMTP**
(e.g. Resend or Amazon SES) under **Authentication → Emails → SMTP Settings**.
Tracked separately.

## Verifying a change

1. **Render** — open each `.html` in a browser; check layout, button, and the
   plain-text fallback link.
2. **Link shape** — confirm each link is
   `https://app.helloautoflow.com/auth/confirm?token_hash=…&type=<type>&next=…`
   with a `type` from the `VALID_OTP_TYPES` set in `AuthConfirm.tsx`.
3. **End-to-end (staging)** — after applying to a non-prod project, trigger
   sign-up and forgot-password, open the received emails, and confirm the link
   lands on `/auth/confirm`, authenticates via `verifyOtp`, and routes to `/`
   (signup) or `/reset-password` (recovery).
