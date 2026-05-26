---
name: autoflow-testing
description: >
  AutoFlow testing reference — Jest + ts-jest backend, vitest + Playwright
  dashboard, the AUTOFLOW_ALLOW_INMEMORY=true convention via jest.env.cjs,
  the 60% coverage gate, supertest patterns for Express routes, the
  test-factories module, idempotent webhook replay assertions, and how
  to write tests that cover both the Postgres + in-memory store branches.
  Use when writing or modifying any test file.
license: Proprietary. Apache-style with the AutoFlow trademark carve-out.
---

# AutoFlow Testing Reference

Backend tests use Jest + ts-jest; dashboard tests use vitest (unit) +
Playwright (e2e). The backend tests run against the **in-memory store
fallback** (HEL-80) by default — `jest.env.cjs` sets
`AUTOFLOW_ALLOW_INMEMORY=true` before any module loads, satisfying the
second of the double-locked gates.

This skill captures test conventions. Test files live next to source as
`<module>.test.ts`; integration tests use `.integration.test.ts` suffix.

---

## 1. Test commands

| Scope | Command | Working dir |
|---|---|---|
| Backend (all) | `npm test` | repo root |
| Backend (one file) | `npx jest --config jest.config.cjs --runInBand src/path/to/file.test.ts` | repo root |
| Backend (one area) | `npm run test:api` / `test:engine` / `test:templates` | repo root |
| Backend coverage | `npm run test:coverage` | repo root |
| Backend type-check | `npx tsc --noEmit` | repo root |
| Dashboard unit | `npm test` | `dashboard/` |
| Dashboard e2e | `npx playwright test` | `dashboard/` |
| Dashboard type-check | `npm run type-check` | `dashboard/` |
| Dashboard lint | `npm run lint` | `dashboard/` |

`--runInBand` is the project default for backend tests — Jest runs serially
so the shared in-memory stores don't leak across worker processes.

---

## 2. The in-memory fallback (`jest.env.cjs`)

`jest.env.cjs` runs in `setupFiles` (before any `import` resolves) and
sets `AUTOFLOW_ALLOW_INMEMORY=true`. Jest auto-sets `NODE_ENV=test`. Both
gates pass → `inMemoryAllowed()` returns true → stores fall back to
process-local maps.

**Do not** set `AUTOFLOW_ALLOW_INMEMORY=true` in shell profiles for
non-test work in production environments. Local dev opts in via
`.env.local`.

Tests that need to verify the Postgres-path-only branch should set
`process.env.DATABASE_URL = "postgres://stub"` and stub the pool — see
existing patterns in `src/billing/subscriptionStore.integration.test.ts`.

---

## 3. Coverage gate

`jest.config.cjs` enforces 60% lines/functions/branches/statements
**globally**, scoped to:

```
src/app.ts
src/auth/**/*.ts
src/billing/**/*.ts
src/engine/**/*.ts
src/llmConfig/**/*.ts
src/mcp/**/*.ts
src/memory/**/*.ts
src/templates/**/*.ts
```

When adding code to these modules, ensure the corresponding test exists
or the coverage gate will fail CI. The gate was restored to 60% branches
in the most recent PR (#1049) — don't lower it. If a temporary drop is
unavoidable, raise it back in the same PR sequence.

`src/test-factories/**` and `src/**/__mocks__/**` are excluded from
coverage by design.

---

## 4. Supertest pattern for Express routes

The conventional shape (see `src/api.test.ts`, `src/appRoutes.test.ts`):

```ts
import request from "supertest";
import app from "./app";
import { issueTestToken } from "./test-factories";

describe("POST /api/agents", () => {
  it("creates an agent with the workspace context applied", async () => {
    const { token, workspaceId } = await issueTestToken({ role: "admin" });

    const res = await request(app)
      .post("/api/agents")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Triage Bot", roleTemplateId: "backend-engineer" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(String),
      workspaceId,
      name: "Triage Bot",
    });
  });

  it("denies when over agentCap", async () => {
    const { token } = await issueTestToken({ plan: "flow" });
    // Pre-create 3 agents (Flow cap).
    // ...
    const res = await request(app)
      .post("/api/agents")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Overflow", roleTemplateId: "backend-engineer" });

    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({
      code: "entitlement_exceeded",
      feature: "agentCap",
      upgradeTo: "automate",
    });
  });
});
```

Always assert the **status code first**, then the body shape. Use
`expect.any(String)` / `expect.objectContaining(...)` for ID-like fields.

---

## 5. Test factories (`src/test-factories/`)

`src/test-factories/index.ts` exports realistic constructors for the
domain shapes — `makeWorkflowRun`, `makeStepResult`, `makeSupportTicketInput`,
`makeCompletedRun`, `makeFailedRun`. Use them instead of duplicating
fixtures across files.

Pattern: factory functions accept an `Overrides` object so tests assert
only the fields they care about:

```ts
const run = makeCompletedRun({ templateId: "tpl-onboarding" });
```

When adding a new factory, follow the existing style: explicit `Overrides`
interface, ISO timestamps via `new Date().toISOString()`, UUIDs via
`crypto.randomUUID()`, no test-only fields leaking into the production
types.

---

## 6. Both-paths coverage for stores

Stores have two backends; tests should cover both:

```ts
describe("entitlementStore", () => {
  describe("in-memory", () => {
    beforeEach(() => {
      delete process.env.DATABASE_URL;
      entitlementStore.resetForTests();
    });
    // ...
  });

  describe("with Postgres", () => {
    beforeEach(() => {
      process.env.DATABASE_URL = "postgres://stub";
      jest.spyOn(pgPool, "query").mockResolvedValue({ rows: [...] });
    });
    // ...
  });
});
```

For pure helpers (no persistence), one test path is sufficient.

---

## 7. Webhook idempotency assertion

Pattern for Stripe / connector webhooks:

```ts
it("is idempotent across replays", async () => {
  const payload = stripeFactory.subscriptionUpdated({...});
  const signature = buildSignature(payload);

  const first = await request(app)
    .post("/api/billing/stripe/webhook")
    .set("Stripe-Signature", signature)
    .send(payload);
  expect(first.status).toBe(200);

  const second = await request(app)
    .post("/api/billing/stripe/webhook")
    .set("Stripe-Signature", signature)
    .send(payload);
  expect(second.status).toBe(200);

  // Critical: the side effects fire exactly once.
  expect(billingMock.upsertSubscriptionAndEntitlements).toHaveBeenCalledTimes(1);
});
```

Every webhook entry point must have a replay test. Don't merge a webhook
handler without one.

---

## 8. Dashboard testing (vitest + Playwright)

- **vitest** runs `*.test.ts(x)` next to source. `dashboard/src/test-setup.ts`
  runs before each suite; `test-global-teardown.ts` runs once after all.
  Use `@testing-library/react` for component tests.
- **Playwright** lives in `dashboard/e2e/`. Tests boot the Vite dev server
  via `playwright.config.ts` and hit the live UI. Auth + workspace bootstrap
  use the QA preview token flow so tests don't need real Supabase sessions.

Don't mock `fetch` ad-hoc — extend the typed API client's mock layer
(`dashboard/src/api/__mocks__/`).

---

## 9. Worktree isolation

Jest config excludes `.claude/worktrees/`, `.worktrees/`, and
`paperclipai-alt*/` directories. When working in a parallel worktree, do
not run tests across the boundary — your changes won't be picked up and
the other tree's stale code might be exercised instead.

---

## 10. Common mistakes

- ❌ Forgetting `--runInBand` and getting nondeterministic failures from
  shared in-memory state.
- ❌ Lowering the coverage threshold to push a PR through — fix the
  uncovered code instead.
- ❌ Hitting real Stripe / Anthropic / OpenAI / Supabase APIs in tests —
  use mocks.
- ❌ Asserting on body before status (a 500 with a stringified error body
  passes a sloppy `expect(res.body.id).toBeDefined()` check).
- ❌ Skipping the replay assertion on a webhook test — idempotency bugs
  silently corrupt billing state in prod.
- ❌ Duplicating fixture objects across tests instead of extending
  `src/test-factories/`.
- ❌ Persisting test data without `resetForTests()` between cases.
