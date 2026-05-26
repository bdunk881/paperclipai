---
name: autoflow-billing
description: >
  AutoFlow billing reference — Stripe subscriptions, the four plan tiers
  (explore / flow / automate / scale), the entitlement matrix, the
  requireEntitlement() middleware, the 402 deny payload contract, the
  webhook event log (idempotency), and how subscription state syncs to
  the canonical entitlements Postgres row. Use when adding/modifying any
  paywall, plan-gated feature, or Stripe webhook handler.
license: Proprietary. Apache-style with the AutoFlow trademark carve-out.
---

# AutoFlow Billing Reference

Billing is Stripe-driven. Every paywall in the app goes through one of two
chokepoints: the `requireEntitlement()` middleware (for API routes) or a
manual `entitlementStore.get(workspaceId)` check (for handlers that need
to branch on the limit rather than 402 out).

Subscription state is canonical in two Postgres tables:
- `subscriptions` (migration 025 + 028) — Stripe subscription bound to a workspace
- `entitlements` (migration 025) — resolved per-workspace plan limits

The Stripe webhook updates both in one transaction. The hot path reads
from an in-memory cache, but falls back to `entitlements` on miss (DASH-48).

---

## 1. Plan tiers (`src/billing/entitlements.ts`)

| Plan | runsPerMonth | agentCap | integrationCap | byokAllowed | logRetentionDays | approvalTierMax |
|---|---|---|---|---|---|---|
| **explore** (free) | 25 | 1 | 1 | true* | 14 | 0 |
| **flow** | 250 | 3 | 3 | false | 30 | 1 |
| **automate** | 1000 | 10 | 10 | true | 90 | 2 |
| **scale** | 10,000 | 50 | 25 | true | 365 | 3 |

\* `byokAllowed: true` on Explore is **temporary** — flipped on while the
hosted free-model path is built. The intent is for Explore to use hosted
models so the BYOK → paid conversion mechanic works. Flip back to `false`
once `src/hostedFreeModels/` is GA.

Stripe price IDs (Infisical env vars): `STRIPE_FLOW_PRICE_ID`,
`STRIPE_AUTOMATE_PRICE_ID`, `STRIPE_SCALE_PRICE_ID`. Explore has no Stripe
subscription — it's the default for any workspace without an active row.

Upgrade ladder: `explore → flow → automate → scale`.

---

## 2. The 402 deny payload

Every `requireEntitlement()` rejection (and every handler that emits an
entitlement error) uses the same shape so the dashboard renders one
consistent "Upgrade to ${tier}" CTA:

```json
{
  "error": "Plan limit reached: agentCap",
  "code": "entitlement_exceeded",
  "feature": "agentCap",
  "limit": 3,
  "current": 3,
  "currentTier": "flow",
  "upgradeTo": "automate"
}
```

- `code` is **always** the literal string `"entitlement_exceeded"`. The
  dashboard's `EntitlementError` class keys off this exact value.
- `upgradeTo` walks the ladder forward and returns the first tier that
  actually allows the feature, skipping tiers where it's still gated.
  For boolean features that need a specific tier (e.g. `byokAllowed`),
  this avoids pointing users at Flow when only Automate+ unlocks it.
- `current` is omitted on boolean features (no count concept).
- HTTP status is **402 Payment Required** — not 403.

---

## 3. `requireEntitlement()` usage patterns

`src/middleware/requireEntitlement.ts`. Boolean feature gate (just check
the flag):

```ts
app.use(
  "/api/llm-configs",
  requireAuth,
  withWorkspace(pool),
  requireEntitlement("byokAllowed"),
  llmConfigRoutes,
);
```

Quota feature gate with a count check (the middleware pre-checks
`current + delta <= limit`):

```ts
app.post(
  "/api/agents",
  requireAuth,
  withWorkspace(pool),
  requireEntitlement("agentCap", {
    getCurrent: (req) => agentStore.countByWorkspace(req.workspace!.id),
    delta: 1,
  }),
  asyncHandler(handler),
);
```

Quota feature with **no** `getCurrent` (just confirm the feature is
allowed at all):

```ts
requireEntitlement("integrationCap")
```

That last form is appropriate for "this action will increment by 1" gates
where the count check happens inside the handler — useful when the count
needs to be re-fetched mid-handler.

`requireEntitlement` 500s if mounted before `withWorkspace(pool)` — keep
the middleware order from the autoflow-backend skill (auth → workspace →
entitlement → role).

---

## 4. Subscription source of truth (DASH-48)

The hot-path cache in `entitlementStore` is a process-local
`Map<workspaceId, WorkspaceEntitlements>`. Pre-DASH-48, a cache miss
returned `undefined`, which the middleware silently downgraded to
"explore" — meaning every Fly restart cancelled paid users' plans until
the next Stripe webhook re-hydrated the cache.

Fixed flow:

1. `entitlementStore.get(workspaceId)` → in-memory hit?
2. If miss → query the `entitlements` Postgres row.
3. If row exists → cache + return it.
4. Only if both miss → default to "explore" and upsert a row.

When you touch this code, **preserve the Postgres fallback**. Don't
revert to the cache-only shape.

---

## 5. Stripe webhook handler (`src/billing/stripeWebhook.ts`)

The webhook is idempotent: every event is recorded in
`stripe_webhook_events` (migration 029) before processing, so replays from
Stripe's retry mechanism never double-charge or double-upgrade.

Event handlers should:
1. Insert into `stripe_webhook_events` with `ON CONFLICT DO NOTHING` keyed
   on `event_id`.
2. If the insert returned 0 rows → already processed → 200 OK + return.
3. Otherwise, do the work inside a transaction that also updates
   `subscriptions` + `entitlements` + the in-memory cache.

The webhook is mounted **before** `express.json()` so Stripe's signature
verification sees the raw bytes — keep it that way. Signature secret comes
from `STRIPE_WEBHOOK_SECRET`.

Tested events: `customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`, `invoice.payment_succeeded`,
`invoice.payment_failed`, `checkout.session.completed`.

---

## 6. Checkout flow (`src/billing/checkoutRoutes.ts`)

POST `/api/checkout/session` creates a Stripe Checkout session for a
plan upgrade. The redirect goes to
`/billing/checkout/success?session_id={CHECKOUT_SESSION_ID}` (handled by
`dashboard/src/pages/CheckoutSuccess.tsx`), which then polls
`/api/subscriptions/me` until the webhook has resolved the new tier.

Don't update entitlements client-side on success — wait for the webhook.
The success page is a "thank you, your plan is provisioning" surface, not
a state mutator.

---

## 7. Test patterns (`src/billing/billing.test.ts`)

Stripe is mocked via `src/billing/__mocks__/`. When adding a billing test:

- Use the existing mock factories — don't hit Stripe's API even in test.
- Cover both `inMemoryAllowed()` and `isPostgresConfigured()` paths if
  your code branches.
- For webhook tests, replay the event twice and assert idempotency
  (second replay must be a no-op).
- The 402 payload shape is asserted in `requireEntitlement.test.ts` —
  don't drift the shape without updating that test.

---

## 8. Common mistakes

- ❌ Returning 403 instead of 402 for plan-gated denials — the dashboard
  matches on 402.
- ❌ Reading `entitlements` without going through `entitlementStore.get()`
  — bypasses the cache + fallback.
- ❌ Updating `subscriptions` without also updating `entitlements` — the
  middleware reads from `entitlements`.
- ❌ Processing a webhook before the `stripe_webhook_events` row insert
  succeeds — replays will double-fire.
- ❌ Mounting `requireEntitlement` before `withWorkspace(pool)` — 500.
- ❌ Hardcoding plan limits anywhere outside `PLAN_LIMITS` in
  `src/billing/entitlements.ts` — drift will break the upgrade-CTA
  computation.
