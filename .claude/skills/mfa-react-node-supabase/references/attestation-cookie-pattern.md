# The attestation-cookie pattern (carrying assurance Supabase won't sign)

When some factors are app-owned (passkeys, recovery codes, email/magic) and the identity provider
(Supabase) won't re-sign its session JWT to carry their assurance, the app must carry AAL2 itself. AutoFlow
does this with a short-lived signed cookie — `autoflow_aal2_attestation`. This is the worked example; the
rules below are what a *correct* version needs.

Source for the cookie/session controls: <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html> ·
<https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html> ·
<https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie> ·
<https://github.com/panva/jose>

## How AutoFlow does it

- On a successful app-factor verify, `mintAal2Attestation` (`src/middleware/requireAAL2.ts:291`) signs an
  HS256 JWT `{ sub, method, iat, exp }` (`aud=autoflow-aal2`, `iss=autoflow-mfa`, reusing `APP_JWT_SECRET`).
- It's delivered as `autoflow_aal2_attestation`: `Path=/; HttpOnly; SameSite=Strict; Max-Age=ttl;` `Secure`
  in prod. `requireAAL2` accepts it (verifying signature + aud + iss + `sub` match) as one of its three
  AAL2 accept-paths.
- `requireWebAuthnAal2` / `staffAuth` re-read the cookie and require `method` ∈ {`webauthn`,`recovery_code`}
  for staff verbs (TOTP fails closed).

## What a correct attestation needs (and AutoFlow's open gaps)

1. **Bind it to the session, not just the user.** Signing only `{sub, method, exp}` means a captured cookie
   is a standalone step-up bypass for its whole TTL. Embed a `jti` (and/or the IdP session id) and persist
   it. → [HEL-340](https://linear.app/helloautoflow/issue/HEL-340)
2. **Revoke on logout & factor-removal.** Clear the cookie on `/sign-out` and when a factor is removed; keep
   a `jti` denylist (small table or short-TTL store) checked on verify. AutoFlow has a
   `buildAal2AttestationClearCookieHeader` helper that is currently **dead code** — wire it in. → HEL-340
3. **Prefer `__Host-` + a dedicated secret.** Use the `__Host-` cookie prefix (forces Secure, Path=/, no
   Domain). Consider a dedicated signing key rather than reusing the app-user JWT secret (AutoFlow separates
   them by `aud`/`iss`, which is acceptable but not ideal).
4. **SameSite=Strict is not a full CSRF defense** for state-changing routes — pair with a token or
   custom-header+Origin check. AutoFlow currently relies on SameSite=Strict + Bearer-JWT identity (the
   cookie attests assurance only, never identity).
5. **Short TTL + freshness.** Keep the attestation short-lived and re-derive AAL per request.

## Reusable shape

```
verify factor  ──►  mint { sub, sid|jti, method, iat, exp }  ──►  Set-Cookie __Host-aal2=…; HttpOnly; Secure; SameSite=Strict; Path=/
requireAAL2    ──►  verify sig + aud + iss + sub + jti-not-revoked  ──►  allow
logout / removeFactor  ──►  revoke jti + clear cookie
```
