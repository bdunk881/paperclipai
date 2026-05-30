# SimpleWebAuthn v11 — gotchas & migration notes

Source: <https://simplewebauthn.dev/docs/packages/server> ·
<https://github.com/MasterKale/SimpleWebAuthn/blob/master/CHANGELOG.md> ·
<https://www.w3.org/TR/webauthn-2/#sctn-sign-counter-considerations>

## The #1 break: `generate*Options` are async in v11

`generateRegistrationOptions()` and `generateAuthenticationOptions()` return a **Promise**. Forgetting to
`await` reads `options.challenge` off the un-awaited Promise as `undefined`, you persist a null challenge,
and verify later throws **"challenge expired or missing"**. This was AutoFlow's HEL-337 bug; the fix is the
`await` in `src/security/simpleWebAuthnAdapter.ts` (L62/L90).

```ts
// WRONG (v10 muscle memory)
const options = generateRegistrationOptions({ ... });   // Promise, not options
await store.put(`reg:${userId}`, options.challenge);    // undefined!

// RIGHT (v11)
const options = await generateRegistrationOptions({ ... });
await store.put(`reg:${userId}`, options.challenge, { ttlSeconds: 300 });
```

## Challenge handling

- Generate server-side, store **single-use** with a ~5-min TTL keyed per user/session, delete on verify
  (atomic `GETDEL` in Redis). Pass the exact stored value to `expectedChallenge`.
- "challenge expired or missing" has exactly three causes: (1) the missing-await above, (2) real >5-min
  expiry, (3) begin/finish on different processes with an in-memory store — so prod must use a shared store
  (AutoFlow requires Redis unless `AUTOFLOW_ALLOW_INMEMORY=true`).

## RP ID & origin

- `rpID` = the bare registrable domain (eTLD+1) so a passkey works across subdomains; set it, `rpName`, and
  `origin` as **trusted constants** — never derive `rpID` from request headers.
- Pass **arrays** to `expectedOrigin` / `expectedRPID` when more than one origin enrolls (e.g. admin +
  dashboard).

## Verify-time enforcement

- Set `userVerification:'required'` in options **and** `requireUserVerification:true` on verify; treat the
  session as stepped-up only when `authenticationInfo.userVerified` is true.
- Persist `authenticationInfo.newCounter` after every auth; flag a **non-increasing** counter as possible
  clone (W3C §6.1.1) — but tolerate authenticators that always report 0 (Apple Touch ID, many platform
  authenticators), so don't hard-fail on `0`.

## v11 shapes

- Verify input: `credential: { id: Base64URLString, publicKey: Uint8Array, counter: number, transports?: ... }`.
- Browser: `startRegistration({ optionsJSON })` / `startAuthentication({ optionsJSON })` (the options are now
  passed under an `optionsJSON` key).
- Catch `InvalidStateError` from `startRegistration` and surface it as "already registered" (pair with
  `excludeCredentials`).
