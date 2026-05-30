# MFA hardening & best-practice reference

> Internal engineering reference. Companion to [mfa-architecture.md](./mfa-architecture.md). DO/DON'T
> distilled from official docs (Supabase, SimpleWebAuthn, React, OWASP, NIST, W3C) during the 2026-05-30
> MFA deep-research pass, with an *Applies here* note per pillar mapping it onto AutoFlow's stack.

## Pillar 1 — Supabase Auth MFA (AAL model)

**DO**
- Model MFA as AAL1→AAL2 step-up; a JWT with no `aal` claim is aal1. Drive UI off
  `getAuthenticatorAssuranceLevel()` (challenge only when `nextLevel==='aal2' && nextLevel!==currentLevel`).
  <https://supabase.com/docs/guides/auth/auth-mfa>
- Enroll with the three-call flow (`enroll`→`challenge`→`verify`); a factor protects only after a successful
  `verify` (filter `status==='verified'`). Use `challengeAndVerify` for login-time step-up.
  <https://supabase.com/docs/reference/javascript/auth-mfa-api>
- On a custom backend, read the `aal` claim out of the verified JWT and compare it yourself; mirror it in
  Postgres RLS as **RESTRICTIVE** policies (they AND, vs permissive OR). <https://supabase.com/blog/mfa-auth-via-rls>
- Use the `amr` claim (chronological `{method, timestamp}`) for "second factor within N minutes" freshness.
- After `unenroll`, force `refreshSession()`. Supabase offers **no** native recovery/backup codes — design recovery separately.

**DON'T**
- Don't use PERMISSIVE RLS for the aal2 check (any other permissive policy ORs it open). Don't require aal2
  unconditionally (locks out un-enrolled users — use the `auth.mfa_factors` opt-in pattern).
- Don't expect Supabase native MFA to cover WebAuthn: native factor types are **only** `totp`/`phone`;
  passkeys are a separate experimental `supabase.auth.passkey` namespace. <https://supabase.com/docs/guides/auth/passkeys>

*Applies here:* TOTP rides Supabase's `aal`; the app's passkey + recovery + email/magic factors carry their
own attestation (the `autoflow_aal2_attestation` cookie).

## Pillar 2 — WebAuthn with @simplewebauthn/server v11

**DO**
- **ALWAYS `await` `generateRegistrationOptions()` / `generateAuthenticationOptions()`** (async in v11). The
  un-awaited Promise yields `options.challenge === undefined` → you persist nothing → verify later throws
  "challenge expired or missing". <https://simplewebauthn.dev/docs/packages/server>
- Generate the challenge server-side, store it single-use with a ~5-min TTL keyed per user/session, and
  delete on verify (Redis works). Pass the exact stored value to `expectedChallenge`.
  <https://simplewebauthn.dev/docs/advanced/passkeys>
- Configure `rpID`/`rpName`/`origin` as trusted constants (rpID = bare registrable domain); pass **arrays**
  to `expectedOrigin`/`expectedRPID` for multi-origin (admin + dashboard). Never derive rpID from request headers.
- For AAL2 step-up, run a fresh authentication ceremony with `userVerification:'required'` AND
  `requireUserVerification:true` on verify; treat the session as stepped-up only when `userVerified` is true.
- Persist `authenticationInfo.newCounter` after every auth and reject/flag a non-increasing counter (clone
  detection, W3C §6.1.1); tolerate authenticators that always report 0 (Apple Touch ID).
  <https://www.w3.org/TR/webauthn-2/#sctn-sign-counter-considerations>
- Use the v11 verify shape `credential: { id (Base64URLString), publicKey (Uint8Array), counter, transports }`;
  on the browser call `startRegistration/startAuthentication({ optionsJSON })`.
  <https://github.com/MasterKale/SimpleWebAuthn/blob/master/CHANGELOG.md>

**DON'T**
- Don't ship reusable/long-lived challenges; don't omit `excludeCredentials` (catch `InvalidStateError` as
  "already registered"); don't set `userVerification:'required'` in options but skip enforcing it on verify.

*Applies here:* HEL-337 was exactly the missing-await pitfall. The codebase still does **not** enforce a
sign-counter regression check (`finishWebauthnAuthentication` writes `newSignCount` unconditionally) — judged
*info*, not a defect (many platform authenticators legitimately report 0).

## Pillar 3 — React 19 auth UX (target-state; both SPAs are 18.3.1 today)

**DO**
- Drive every async auth step with React 19 Actions: `useActionState` (carry challenge IDs / chosen factor
  in `previousState`), `useFormStatus` in nested Verify/Resend/Cancel buttons, async `startTransition` for
  the `@simplewebauthn/browser` ceremony. <https://react.dev/reference/react/useActionState>
- Use `useOptimistic` **only** for reversible factor-list edits — never to pre-claim an AAL2 grant.
  <https://react.dev/reference/react/useOptimistic>
- Read enrolled-factor/AAL state via Suspense + `use()` backed by a **stable** promise (TanStack Query
  suspense), wrapped in an Error Boundary; return recoverable "code expired/challenge missing" as action
  state, throw only on real faults. <https://react.dev/reference/react/use>
- For React Router 7 SPAs, use Data mode (`createBrowserRouter`) and `throw redirect('/login')` from loaders
  on no-session/sub-AAL2. <https://reactrouter.com/start/data/route-object>

**DON'T**
- Don't expect RSC / `'use server'` / `useActionState` `permalink` to apply — this is a decoupled Vite SPA +
  Express API; use **client** Action primitives only. Don't call `useFormStatus()` in the same component that
  renders `<form>`. Don't create the `use()` promise inline in render. <https://react.dev/blog/2024/12/05/react-19>

*Applies here:* both SPAs use manual busy/error `useState` machines — a clean future simplification, not a
defect. Note `docs/` is already React Router 7 + React 19, so the patterns are in-house.

## Pillar 4 — OWASP / NIST MFA

**DO**
- Treat AAL2 as two **distinct** factors with at least one replay-resistant; password+PIN is not MFA. Prefer
  phishing-resistant WebAuthn for admins (origin-bound). <https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html>
- Make OTPs single-use, short-TTL, CSPRNG, ≥20 bits entropy, invalidated on success, hashed at rest, and
  **never logged**; magic-link tokens high-entropy single-use. <https://pages.nist.gov/800-63-3/sp800-63b.html>
- Throttle verification per-account/per-IP with exponential backoff, far below NIST's 100-failure ceiling
  (Upstash Redis is available).
- Gate enrollment/removal/"disable MFA" behind step-up reauthentication with an existing factor, plus an
  out-of-band email notice. Regenerate the session ID and persist achieved AAL server-side on the AAL1→AAL2
  transition; re-derive AAL per request. Manually-entered OTP (TOTP/email-OTP) is **not**
  verifier-impersonation-resistant — only WebAuthn is. AAL2 session limits: reauth ≤12h and after 30 min
  inactivity.

**DON'T**
- Don't reuse an OTP within its window; don't accept TOTP twice; don't use SMS for high-value/admin (NIST
  RESTRICTED); don't let recovery silently downgrade assurance; don't leak account existence (generic,
  constant-time errors).

*Applies here:* recovery codes use fast salted SHA-256 (fine at 80-bit) but the same hasher covers 6-digit
OTPs (10^6 space) — short-TTL + 3-attempt-locked, so judged *info* not a high gap.

## Pillar 5 — Node session / cookie security

**DO**
- Set every auth cookie HttpOnly + Secure + SameSite (Strict preferred); use the `__Host-` prefix (forces
  Secure, Path=/, no Domain). `app.set('trust proxy', 1)` behind Fly so Secure cookies/HSTS work.
  <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>
- For credentialed cross-origin APIs, reflect a **single** allowlisted origin (never `*`, never blind-echo),
  set `Access-Control-Allow-Credentials: true`, add `Vary: Origin`.
  <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Access-Control-Allow-Origin>
- Verify JWTs with `jose`: `createRemoteJWKSet` + pin `algorithms`, require `issuer`+`audience`, add
  `clockTolerance`/`maxTokenAge`. <https://github.com/panva/jose>
- Keep access tokens in memory / Query cache (not localStorage); put the refresh/session reference in an
  HttpOnly cookie. Tune helmet's CSP for the SPA's real origins (helmet does **not** set CORS).

**DON'T**
- Don't treat SameSite as a complete CSRF fix — pair it with a session-bound CSRF token or
  custom-header+Origin check on state-changing routes. Don't store JWTs in localStorage. Don't omit the `jose`
  `algorithms`/`issuer`/`audience` checks.

*Applies here:* the AAL2 cookie is HttpOnly+SameSite=Strict but **host-only** (no Domain, no `__Host-`
prefix) and there is no CSRF token layer; CORS is a correct strict allowlist in `src/app.ts`.

---

## Open gaps (verified 2026-05-30)

Four candidate gaps survived adversarial verification; four were refuted. Each open gap has a ticket.

| Ticket | Sev | Gap |
|---|---|---|
| [HEL-339](https://linear.app/helloautoflow/issue/HEL-339) | High | OAuth sessions auto-elevate to AAL2 for sensitive ops with no freshness window (`requireAAL2.ts:185-197`). Documented design (HEL-280/HEL-305) → product/security sign-off. |
| [HEL-342](https://linear.app/helloautoflow/issue/HEL-342) | High | MFA email transport wired to SendGrid-by-env-key; **switch to Resend** + fail closed in prod (`mfaEmailSender.ts:159-163`). |
| [HEL-340](https://linear.app/helloautoflow/issue/HEL-340) | Med | AAL2 attestation cookie unbound to session & never revoked on logout/factor-removal (`requireAAL2.ts:291-303`). |
| [HEL-343](https://linear.app/helloautoflow/issue/HEL-343) | Med | No boot assertion that `MFA_ORIGIN ⊆ ALLOWED_ORIGINS`; silent `localhost` fallback (`mfaService.ts:468-471`). |
| [HEL-341](https://linear.app/helloautoflow/issue/HEL-341) | Low | `mfa_email_otp`/`mfa_magic_link` use ENABLE not FORCE RLS (migration 093). |

**Refuted on inspection (recorded so they aren't re-raised):** "MFA endpoints have no rate limiting"
(false — 3-attempt lock + 5/hr send limit); "sign-counter regression unchecked" (info — counter written,
many authenticators report 0); "recovery/OTP use SHA-256 not bcrypt → brute-forceable" (info — 80-bit
recovery codes fine); "attestation + legacy tokens share `APP_JWT_SECRET`" (false alarm — separated by
`aud`/`iss`).

**Verify-first (not yet ticketed):** prod has no admin-console origin in `ALLOWED_ORIGINS`/`MFA_ORIGIN`
(C4); confirm `REDIS_URL` reaches the `app` process for the challenge store (C5).
