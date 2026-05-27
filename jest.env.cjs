/**
 * Jest test-environment bootstrap — runs before any test loads, before any
 * application module is imported.
 *
 * Sets defaults that production startup deliberately rejects (per HEL-80) so
 * the existing test suite — which relies on in-memory store fallbacks — keeps
 * working without each test having to opt in.
 *
 * - `AUTOFLOW_ALLOW_INMEMORY="true"` — second gate of the double-locked
 *   in-memory fallback (see src/db/postgres.ts inMemoryAllowed()). Jest sets
 *   `NODE_ENV=test` automatically; this satisfies the second gate.
 *
 * Local development (outside Jest) should set this in your shell profile or
 * `.env.local` — see `.env.local.example` for the documented variable.
 */

if (!process.env.AUTOFLOW_ALLOW_INMEMORY) {
  process.env.AUTOFLOW_ALLOW_INMEMORY = "true";
}

// HEL-mfa: pre-existing tests mock `requireAuth` but don't know about the
// AAL2 step-up gate added on billing/llm-creds/admin routes. Default the
// gate to "disabled" for tests so those suites keep working without each
// having to stub `requireAAL2`. The MFA-specific tests
// (src/middleware/requireAAL2.test.ts, src/security/mfaService.test.ts,
// src/admin/staffAuth.test.ts) delete this env var in their beforeEach so
// the real gate behavior is still verified end-to-end.
if (!process.env.MFA_DISABLE_AAL2_ENFORCEMENT) {
  process.env.MFA_DISABLE_AAL2_ENFORCEMENT = "true";
}
