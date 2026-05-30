# OWASP / NIST MFA controls

Source: <https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html> ·
<https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html> ·
<https://pages.nist.gov/800-63-3/sp800-63b.html>

## What AAL2 actually requires

- **Two distinct factors**, at least one replay-resistant. Password + PIN is *not* MFA (both "something you
  know"). Prefer phishing-resistant **WebAuthn** for admins (it's origin-bound; manually-entered OTP —
  TOTP/email — is *not* verifier-impersonation-resistant).
- AAL2 session limits: reauthenticate at least every **12h**, and after **30 min** of inactivity.
- Regenerate the session ID and persist the achieved AAL server-side on the AAL1→AAL2 transition; re-derive
  AAL per request.

## OTP / token rules

- Single-use, short TTL, CSPRNG, **≥20 bits** entropy, invalidated on success, **hashed at rest**, and
  **never logged**. Magic-link tokens: high-entropy, single-use.
- Throttle verification per-account and per-IP with exponential backoff, far below NIST's 100-consecutive-
  failure ceiling. (AutoFlow: email-OTP locks after 3 attempts; a shared 5/hr send limit spans email-OTP +
  magic-link.)
- Don't reuse an OTP within its window; don't accept the same TOTP twice; don't use **SMS** for
  high-value/admin accounts (NIST RESTRICTED).

## Lifecycle & UX

- Gate enrollment, factor removal, and "disable MFA" behind **step-up reauthentication** with an existing
  factor, plus an **out-of-band** email notice.
- Don't let account recovery silently downgrade assurance.
- Use generic, constant-time errors so you don't leak account existence.

## Quick AAL2 audit checklist

- [ ] Two genuinely distinct factors; ≥1 phishing-resistant for privileged roles.
- [ ] OTPs CSPRNG, hashed, single-use, short-TTL, never logged.
- [ ] Verification throttled (per-account + per-IP).
- [ ] Factor add/remove requires step-up + sends an out-of-band notice.
- [ ] Session regenerated on AAL change; AAL re-derived per request, not cached client-side.
- [ ] No SMS for admins.
