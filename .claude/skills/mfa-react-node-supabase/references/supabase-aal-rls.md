# Supabase Auth MFA — AAL model & RLS

Source: <https://supabase.com/docs/guides/auth/auth-mfa> ·
<https://supabase.com/blog/mfa-auth-via-rls> ·
<https://supabase.com/docs/reference/javascript/auth-mfa-api> ·
<https://supabase.com/docs/guides/auth/passkeys>

## The AAL model

- A session JWT with no `aal` claim is **aal1**; a verified second factor makes it **aal2**.
- Enrollment is a three-call flow: `mfa.enroll` → `mfa.challenge` → `mfa.verify`. A factor only protects
  after a successful `verify` (filter `status === 'verified'`). Use `mfa.challengeAndVerify` for login-time
  step-up.
- `getAuthenticatorAssuranceLevel()` returns `{ currentLevel, nextLevel }`. Show a challenge only when
  `nextLevel === 'aal2' && nextLevel !== currentLevel`.
- The `amr` claim is a chronological list of `{ method, timestamp }` — use it for "second factor within N
  minutes" freshness windows (AutoFlow's `MFA_STEP_UP_TTL`, default 15 min).
- After `mfa.unenroll`, call `refreshSession()` — the downgrade otherwise lags the refresh interval.
- Supabase has **no** native recovery/backup codes — design recovery yourself (AutoFlow issues app-owned
  recovery codes).

## Native factor types: totp & phone ONLY

Supabase native MFA covers **`totp`** and **`phone`** only. Passkeys are a separate, experimental
`supabase.auth.passkey` namespace. **Track WebAuthn assurance yourself** — AutoFlow does this with the
`autoflow_aal2_attestation` cookie rather than the Supabase session.

## Enforcing AAL2 in Postgres RLS

Use **RESTRICTIVE** policies for the aal2 check — they `AND` with other policies, so they can't be ORed open
by a permissive policy:

```sql
-- RESTRICTIVE: every other policy must ALSO pass
create policy "require_aal2_for_sensitive"
  on public.sensitive_table
  as restrictive
  for all
  to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2');
```

- **Don't** require aal2 unconditionally — it locks out users who haven't enrolled. Gate on the
  `auth.mfa_factors` opt-in pattern (only require aal2 for users who have a verified factor).
- On a custom backend (AutoFlow's Express API), read the `aal` claim out of the **verified** JWT and compare
  it yourself (`requireAAL2.ts`) — don't trust an unverified token.
