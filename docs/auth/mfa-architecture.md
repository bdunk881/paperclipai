# MFA architecture (AutoFlow)

> Internal engineering reference. Audience: anyone touching auth, AAL2 step-up, WebAuthn, or the
> MFA factors. Produced by the 2026-05-30 MFA deep-research pass. Companion: [mfa-hardening.md](./mfa-hardening.md).

AutoFlow's MFA is a **hybrid, app-layer system on top of Supabase Auth**, spanning the Node/Express API
(`src/`) and two React 18.3.1 SPAs (`admin/`, `dashboard/`). Only **TOTP** is delegated to Supabase; every
other factor is app-owned and records assurance through a short-lived **AAL2 attestation cookie**.

## Responsibility split

`src/security/mfaService.ts` (`class MfaService`) orchestrates all factors.

- **TOTP → Supabase.** `src/security/supabaseTotpAdapter.ts` calls gotrue REST (`/auth/v1/factors`
  enroll/challenge/verify) with the publishable/anon apikey + the end-user's bearer token, so **Supabase
  itself mints** a JWT carrying `aal:"aal2"` and an `amr` entry.
- **Passkeys, recovery codes, email-OTP, magic-link → app-owned.** Stored in app Postgres tables
  (migrations `075_mfa_enrollment.sql` + `093_mfa_email_factors.sql`). On successful verify they mint an
  **HS256 "AAL2 attestation"** delivered as the `autoflow_aal2_attestation` HttpOnly cookie.

The app touches Supabase only two ways: JWT verification via JWKS using `jose`
(`src/auth/supabaseAuth.ts`), and the gotrue REST fetch above. There is **no service-role admin client**
in the MFA path. DB access is a Postgres pool with per-request RLS context (`src/security/mfaRepository.ts`,
`withUserContext` sets `app.current_user_id` to satisfy FORCE-RLS from migration 083).

## Factor inventory

| Factor | Owner | Storage | Notes |
|---|---|---|---|
| **WebAuthn passkey** | app (`@simplewebauthn`) | `mfa_webauthn_credentials` (COSE public key + `sign_count`) | phishing-resistant; preferred/required for staff |
| **TOTP** | Supabase gotrue | Supabase | the only factor that rides Supabase's native `aal2` JWT |
| **email-OTP** | app | `mfa_email_otp` (salted SHA-256, 5-min TTL) | 6-digit; locks after 3 attempts; staff blocked |
| **magic-link** | app | `mfa_magic_link` (unsalted SHA-256 of 256-bit token) | **pre-auth** verify via `SECURITY DEFINER consume_mfa_magic_link()`; staff blocked |
| **recovery codes** | app | `mfa_recovery_codes` (salted SHA-256) | 10 × 80-bit; one-time use |

A shared **5/hr per-user send rate-limit** spans email-OTP + magic-link. Staff are blocked from email
factors (`assertNotStaff`).

## WebAuthn ceremony + the challenge store

`beginWebauthnRegistration` (`mfaService.ts:512`) calls `webauthn.generateRegistrationOptions` and stores
`options.challenge` under `reg:<userId>`; `finishWebauthnRegistration` (L536) consumes it and calls
`verifyRegistrationResponse` with `expectedChallenge`/`expectedOrigin`/`expectedRPID`. Authentication
mirrors this under `auth:<userId>`.

`src/security/simpleWebAuthnAdapter.ts` wraps `@simplewebauthn/server` v11:
`generateRegistrationOptions` (L62) and `generateAuthenticationOptions` (L90) are **async and awaited**
(the HEL-337 fix — see [mfa-hardening.md](./mfa-hardening.md) Pillar 2). Config: `attestationType:'none'`,
`residentKey:'preferred'`, `userVerification:'required'`, and `requireUserVerification:true` on verify.

Challenges live in **Redis** (`src/security/mfaChallengeStore.ts`, key prefix `mfa:challenge:`, 5-min TTL
via `SET EX`, atomic `GETDEL` on consume). `getDefaultMfaChallengeStore` **throws in production** if Redis
is absent unless `AUTOFLOW_ALLOW_INMEMORY=true`.

## AAL1 → AAL2 enforcement

`req.auth.aal` / `req.auth.amr` come off the verified Supabase JWT (`src/auth/authMiddleware.ts`,
`parseAalClaim` / `parseAmrClaim`). `requireAAL2Impl` (`src/middleware/requireAAL2.ts:199`) accepts a
request if **ANY** of:

1. **`checkSupabaseAal2` (L128)** — `aal==="aal2"` AND a `totp`/`webauthn`/`phone` `amr` entry within
   `MFA_STEP_UP_TTL_SECONDS` (default 15 min).
2. **`checkOauthShortcut` (L185)** — `amr` contains `{method:"oauth"}`; trusted unless the workspace flag
   `require_app_mfa_for_oauth_users` is set, and trusted **unconditionally when no workspaceId is bound**
   (L190). ⚠️ See [HEL-339](https://linear.app/helloautoflow/issue/HEL-339).
3. **Attestation cookie** — a valid, unexpired `autoflow_aal2_attestation` whose `sub` matches `req.auth.sub`
   (L225).

App-side factors record assurance by minting the HS256 attestation (`mintAal2Attestation` L281, claims
`{sub, method, iat, exp}`) and setting the cookie (`buildAal2AttestationClearCookieHeader`/`build...CookieHeader`
L311: `Path=/; HttpOnly; SameSite=Strict; Max-Age=ttl;` `Secure` only in production). It is **not** written
back into the Supabase JWT (the app can't re-sign Supabase tokens).

`src/middleware/requireWebAuthnAal2.ts` tightens this to **passkey-only** (re-reads the cookie, rejects
unless `method==="webauthn"`) and is wired to exactly one endpoint, platform-admin revoke.
`src/admin/staffAuth.ts` (`requireStaff`) accepts only `webauthn` or `recovery_code` attestations (TOTP
fails closed). The attestation reuses `APP_JWT_SECRET` (`src/auth/appAuthTokens.ts`), distinguished by
`aud=autoflow-aal2` / `iss=autoflow-mfa`.

## Email-OTP + magic-link (HEL-282)

6-digit OTP via `crypto.randomInt`; magic-link is 32 random bytes base64url (256-bit). OTP stored salted
SHA-256, magic-link unsalted SHA-256, both 5-min TTL. Send goes through `src/security/mfaEmailSender.ts`.
**Transport caveat:** the only wired sender is `SendGridMfaEmailSender`, gated on `SENDGRID_API_KEY` +
`AUTOFLOW_APPROVAL_EMAIL_FROM`; with no key it silently falls back to logging. The canonical provider is
**Resend**, not yet wired — see [HEL-342](https://linear.app/helloautoflow/issue/HEL-342). Magic-link
verify is **pre-auth**: `app.get /api/mfa/magic-link/verify` is mounted public **before** the authed router
(`src/app.ts`), calls `SECURITY DEFINER consume_mfa_magic_link()`, then mints the cookie + 302.

## Per-environment config

Three non-secret values drive WebAuthn + CORS, set per-env in the Fly TOML `[env]` blocks (**not**
Infisical): `MFA_RP_ID = helloautoflow.com` (eTLD+1 in all three envs, so a passkey works cross-subdomain),
`MFA_RP_NAME = AutoFlow`, and `MFA_ORIGIN` — a comma list that **must mirror `ALLOWED_ORIGINS`** for that
env (dev = 4 origins, staging = 2, production = 3). The `MfaService` constructor (`mfaService.ts:468-471`)
falls back to `localhost` / `http://localhost:5173` if these are unset, and there is **no boot assertion**
that `MFA_ORIGIN ⊆ ALLOWED_ORIGINS` — see [HEL-343](https://linear.app/helloautoflow/issue/HEL-343).
`src/app.ts` runs `helmet()` then `cors()` with a strict origin allowlist (`credentials:true`); there is
no CSRF middleware (resistance rests on `SameSite=Strict` + Bearer-JWT identity).

## Frontend

Both SPAs (`admin/` = `autoflow-admin`, `dashboard/` = `autoflow-dashboard`) are **React ^18.3.1** with
`@simplewebauthn/browser` ^11 — **no React 19 primitive anywhere** (target-state migration covered in
[mfa-hardening.md](./mfa-hardening.md) Pillar 3). Three surfaces × two apps:

- **Enrollment wizard** — `admin/src/pages/MfaEnrollmentWizard.tsx` (inline); `dashboard/src/auth/MfaEnrollmentFlow.tsx`
  (a 6-state `choose → enroll-<factor> → recovery-codes` machine with four factor cards).
- **Step-up modal** — `{admin,dashboard}/src/auth/MfaStepUpModal.tsx` (method switcher, 5 modes).
- **Security settings card** — `{admin,dashboard}/src/pages/security/MfaSettingsCard.tsx`.

The WebAuthn ceremony is centralized in `auth/mfa.ts` (`registerPasskey`/`verifyPasskey` wrap
`startRegistration`/`startAuthentication` with `{ optionsJSON }`). All MFA calls are **hand-rolled fetch**
(admin: raw fetch; dashboard: `trackedFetch` with Sentry + 15s timeout + 429 cooldown), **not** TanStack
Query, and both send `Authorization: Bearer` + `credentials:include` so the AAL2 cookie rides along.
Step-up is a **window-event bus**: a 401 `{error:"mfa_step_up_required"}` emits
`autoflow:mfa:step-up-required`, the globally-mounted modal opens, fetches `/api/mfa/policy`, and on success
emits `satisfied` — but the documented `awaitStepUp()` auto-resume in `stepUpEvents.ts` is never called, so
the original action is dropped and the user manually retries.

## Failure signatures → cause

| Symptom | Likely cause |
|---|---|
| `"challenge expired or missing"` | (1) missing `await` on `generate*Options` (HEL-337 class), (2) real >5-min expiry, or (3) begin/finish on different processes with an in-memory store (pre-HEL-303; prod requires Redis) |
| Passkey verify fails only in prod | `MFA_ORIGIN`/`MFA_RP_ID` drift vs `ALLOWED_ORIGINS`, or the silent `localhost` fallback ([HEL-343](https://linear.app/helloautoflow/issue/HEL-343)) |
| Step-up succeeds but the original action is dropped | `awaitStepUp()` auto-resume not wired; user must retry |
| Email-OTP / magic-link never arrives | `SENDGRID_API_KEY` unset → silent logging fallback ([HEL-342](https://linear.app/helloautoflow/issue/HEL-342)) |

## See also

- [mfa-hardening.md](./mfa-hardening.md) — best-practice reference + open gaps.
- Open gap tickets: [HEL-339](https://linear.app/helloautoflow/issue/HEL-339),
  [HEL-340](https://linear.app/helloautoflow/issue/HEL-340),
  [HEL-341](https://linear.app/helloautoflow/issue/HEL-341),
  [HEL-342](https://linear.app/helloautoflow/issue/HEL-342),
  [HEL-343](https://linear.app/helloautoflow/issue/HEL-343).
- Skill: `.claude/skills/mfa-react-node-supabase/` (Claude Code review skill seeded from this research).
