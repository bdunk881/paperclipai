---
name: mfa-react-node-supabase
description: >-
  Configure and review a React + Node/Express + Supabase MFA system (Supabase AAL + SimpleWebAuthn
  passkeys + custom TOTP / email-OTP / magic-link factors). Use when building or reviewing MFA enrollment,
  AAL1→AAL2 step-up gates, WebAuthn/passkey ceremonies, OTP / magic-link factors, or attestation cookies on
  a decoupled Vite-SPA + Express-API + Supabase stack (AutoFlow's setup).
---

# MFA: React + Node + Supabase

AutoFlow's MFA is a **hybrid, app-layer system on Supabase Auth**. Orient before changing anything; most
bugs come from misunderstanding the responsibility split.

Full internal docs: [`docs/auth/mfa-architecture.md`](../../../docs/auth/mfa-architecture.md) and
[`docs/auth/mfa-hardening.md`](../../../docs/auth/mfa-hardening.md).

## When to use

Building or reviewing: MFA enrollment, AAL1→AAL2 step-up gates, `@simplewebauthn` ceremonies, custom
OTP/magic-link factors, the attestation cookie, or the WebAuthn/CORS origin config — on this Vite-SPA +
Express-API + Supabase stack.

## Orient first: the hybrid architecture

- **TOTP is delegated to Supabase gotrue** (`src/security/supabaseTotpAdapter.ts`) → Supabase mints the
  `aal2`/`amr` JWT natively.
- **Passkeys, recovery codes, email-OTP, magic-link are app-owned** (`src/security/mfaService.ts`) → on
  verify they mint a short-lived HS256 **AAL2 attestation** in the `autoflow_aal2_attestation` HttpOnly
  cookie that `src/middleware/requireAAL2.ts` accepts in lieu of a Supabase aal2 token.

Name the seams before editing: the **challenge store** (`mfaChallengeStore.ts`, Redis, 5-min TTL), the
**AAL2 mint/verify middleware** (`requireAAL2.ts`; `requireWebAuthnAal2.ts` / `staffAuth.ts` for
passkey-only staff verbs), and the **RP/origin config read** (`mfaService.ts:468-471`, from Fly toml `[env]`).

## Five-pillar checklist

See [`references/`](./references/) for the cited detail. The highest-value rules:

1. **Supabase AAL** — drive UI off `getAuthenticatorAssuranceLevel()`; gate the backend on the JWT `aal`
   claim; mirror in RLS as **RESTRICTIVE** policies; native factors are **only** totp/phone (passkeys are
   app-owned). → [`references/supabase-aal-rls.md`](./references/supabase-aal-rls.md)
2. **SimpleWebAuthn v11** — **`await` `generate*Options`** (the #1 break); single-use 5-min challenge;
   `rpID`/`origin` as constants (arrays for multi-origin); enforce `requireUserVerification:true`; persist
   `newCounter`; v11 `credential` shape + `{ optionsJSON }` browser API. →
   [`references/simplewebauthn-v11-migration.md`](./references/simplewebauthn-v11-migration.md)
3. **React 19 auth UX (target)** — `useActionState`/`useFormStatus`/`useOptimistic`/`use()`+Suspense;
   **client** primitives only on a Vite SPA; RR7 Data mode redirect-from-loader. (Both app SPAs are 18.3.1
   today.)
4. **OWASP/NIST** — two distinct factors; OTP single-use/CSPRNG/≥20-bit/hashed/**never-logged**; throttle;
   step-up for factor changes + out-of-band notice; regenerate session on assurance change; WebAuthn is the
   only phishing-resistant factor. → [`references/owasp-nist-mfa-controls.md`](./references/owasp-nist-mfa-controls.md)
5. **Node session/cookie** — HttpOnly+Secure+SameSite+`__Host-`; single-origin credentialed CORS +
   `Vary: Origin`; `jose` pin algorithms+iss+aud; no tokens in localStorage; SameSite is **not** a CSRF fix.
   → [`references/attestation-cookie-pattern.md`](./references/attestation-cookie-pattern.md)

## Failure signatures → cause

- **"challenge expired or missing"** → missing `await` on `generate*Options` **OR** in-memory store across
  processes **OR** real >5-min expiry. Check the await first.
- **Step-up succeeds but the action is dropped** → `awaitStepUp()` auto-resume not wired (`stepUpEvents.ts`).
- **Passkey verify fails only in prod** → `MFA_ORIGIN`/`MFA_RP_ID` drift vs `ALLOWED_ORIGINS`, or the silent
  `localhost` fallback.
- **Email-OTP / magic-link never arrives** → mail provider key unset → silent logging fallback.

## Review rubric (grep-for classes)

When reviewing an MFA change, check for: OAuth-`amr` auto-AAL2 with no freshness window; plaintext OTP/token
logging with no `NODE_ENV` guard; attestation cookie unbound to session / not revoked on logout or
factor-removal; ENABLE-vs-FORCE RLS on pre-auth tables; missing sign-counter regression check; and a missing
boot assertion that `MFA_ORIGIN ⊆ ALLOWED_ORIGINS`. (These are the gap classes verified in HEL-339..343.)
