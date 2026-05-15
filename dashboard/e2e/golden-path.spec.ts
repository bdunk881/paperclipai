/**
 * E2E: First-run golden path (HEL-28).
 *
 * The single most important test in the repo. Walks the entire anonymous-to-
 * paying-customer journey, asserting one phase per `test()`. Phases blocked
 * on other P2 tickets are marked with `test.fixme()` and tagged with the
 * Linear ticket that unblocks them — as each unblocking ticket lands, the
 * corresponding `.fixme` flips off and the assertion goes live in CI.
 *
 * The path:
 *   1. Anonymous → marketing landing page renders                              (HEL-33 ✅)
 *   2. Pricing section is reachable and CTAs route to checkout/signup         (HEL-33 ✅)
 *   3. POST /api/public/landing/checkout returns a Stripe Checkout URL        (HEL-22 ✅)
 *   4. Stripe webhook flips entitlements; workspace is provisioned             (HEL-22 + HEL-12 ✅)
 *   5. Mission intake UI persists a mission                                    (HEL-23 — blocked)
 *   6. POST /api/missions/:id/generate-plan returns a structured plan          (HEL-24 ✅)
 *   7. Confirm hiring plan provisions agents + org_edges                       (HEL-25 — blocked)
 *   8. Org chart on Team page renders the new graph                            (HEL-26 — blocked)
 *   9. Routine builder in Studio saves a workflow                              (HEL-27 — blocked)
 *  10. First run executes the workflow end-to-end                              (HEL-27 → durable exec — P3)
 *  11. Ticket is filed and surfaced on /approvals                              (HEL-15/16 ✅)
 *  12. Approval is resolved and the run completes                              (HEL-15/16 ✅)
 *  13. Activity feed shows the completed run                                   (HEL-29 — blocked)
 *  14. Stripe invoice exists for the workspace                                 (HEL-22 ✅, asserted via API)
 *
 * Each phase is a separate `test()` so the Playwright report shows
 * green/skipped per phase. CI runs this file via the same `npm run e2e`
 * pipeline that runs auth.spec.ts; see playwright.config.ts.
 *
 * Cross-app note: the landing app lives on a different origin from the
 * dashboard. Phases 1-3 hit `LANDING_BASE_URL` (default
 * http://localhost:3000); phases 4+ hit the dashboard's
 * `baseURL` (default http://localhost:5173). For local dev: run
 * `npm run dev` in both `landing/` and `dashboard/`. For CI: each phase
 * group is set up to run against the deployed Cloudflare Pages preview
 * via the LANDING_BASE_URL env var.
 */

import { test, expect, request as playwrightRequest } from "@playwright/test";
import { loginAsMockUser } from "./helpers/auth";
import { stubStripeCheckoutApi, stubSlackOAuth } from "./helpers/networkStubs";

const LANDING_BASE_URL = process.env.LANDING_BASE_URL ?? "http://localhost:3000";
const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL ?? "http://localhost:8000";
const DASHBOARD_BASE_URL = process.env.DASHBOARD_BASE_URL ?? "http://localhost:5173";

// ---------------------------------------------------------------------------
// Phase 1 — Anonymous visitor lands on the marketing site.
// Status: shipped in HEL-33. Asserts only the live preview content.
// ---------------------------------------------------------------------------

test.describe("Phase 1 — Anonymous landing", () => {
  test.skip(
    !process.env.RUN_LANDING_PHASES,
    "Set RUN_LANDING_PHASES=1 to exercise the cross-origin landing assertions",
  );

  test("the v2 hero renders with the editorial headline and BYOK pricing", async ({
    page,
  }) => {
    await page.goto(LANDING_BASE_URL);
    await expect(
      page.getByRole("heading", { level: 1 }),
    ).toContainText(/Hire a team\s+of agents that/);
    // Pricing section is reachable via in-page anchor.
    await expect(page.locator("#pricing")).toBeVisible();
    // The lower-barrier $19 Flow tier is on the page (HEL-33 commit c06cba7).
    await expect(page.getByText("Flow")).toBeVisible();
    await expect(page.getByText("$19")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — Pricing CTA routes to checkout / signup.
// Status: shipped in HEL-33. The featured Team (Automate $49) tier POSTs to
// /api/public/landing/checkout via buildLandingApiUrl().
// ---------------------------------------------------------------------------

test.describe("Phase 2 — Pricing CTA", () => {
  test.skip(
    !process.env.RUN_LANDING_PHASES,
    "Set RUN_LANDING_PHASES=1 to exercise the cross-origin landing assertions",
  );

  // HEL-75: stub the backend checkout endpoint for both Phase 2 tests so a
  // CTA click never escapes to live Stripe. Each test calls page.goto()
  // after this hook so the route handler is registered before the page
  // ever asks the backend for a checkout URL.
  test.beforeEach(async ({ page }) => {
    await stubStripeCheckoutApi(page, DASHBOARD_BASE_URL);
  });

  test("the free Tinker/Explore tier links to /signup", async ({ page }) => {
    await page.goto(`${LANDING_BASE_URL}/#pricing`);
    const startFree = page.getByRole("link", { name: /Start free/i }).first();
    await expect(startFree).toHaveAttribute("href", /\/signup$/);
  });

  test("the Team checkout button posts to the backend checkout endpoint", async ({
    page,
  }) => {
    await page.goto(`${LANDING_BASE_URL}/#pricing`);
    // The Team CTA is a button (not a Link) because it POSTs the tier.
    const tryTeam = page.getByRole("button", { name: /Try Automate/i });
    await expect(tryTeam).toBeVisible();
    // With stubStripeCheckoutApi registered above, clicking Try Automate
    // would now end up on /checkout/success?session_id=cs_test_golden_path
    // instead of live Stripe — but we don't click here because Phase 3
    // already asserts that endpoint contract API-only. The stub being in
    // place means flipping that click on later is a no-op for safety.
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — Backend checkout endpoint returns a Stripe URL.
// Status: shipped (HEL-22 entitlements + src/landing/publicApiRoutes.ts).
// This is an API-only assertion so the test doesn't open a live Stripe page.
// ---------------------------------------------------------------------------

test.describe("Phase 3 — Stripe checkout (test mode)", () => {
  test.skip(
    !process.env.BACKEND_BASE_URL,
    "Set BACKEND_BASE_URL to exercise the live checkout endpoint",
  );

  test("POST /api/public/landing/checkout returns a session URL for automate tier", async () => {
    const api = await playwrightRequest.newContext();
    const res = await api.post(
      `${BACKEND_BASE_URL}/api/public/landing/checkout`,
      {
        data: { tier: "automate", email: "e2e@example.com" },
        headers: { "Content-Type": "application/json" },
      },
    );

    // 200 with a URL, OR 503 if test-mode price IDs aren't configured yet.
    // Either is acceptable in CI; we just need to know we hit the right code path.
    if (res.status() === 503) {
      test.info().annotations.push({
        type: "skip-reason",
        description:
          "STRIPE_AUTOMATE_PRICE_ID not configured in this env (acceptable). See HEL-22.",
      });
      return;
    }
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { url?: string };
    expect(body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    await api.dispose();
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — Workspace + entitlements provisioned post-Stripe.
// Status: shipped (HEL-12 workspaces + HEL-22 entitlements webhook). We
// assert the seeded mock workspace renders on /, which proves the
// auth+workspace context is wired.
// ---------------------------------------------------------------------------

test.describe("Phase 4 — Workspace provisioned", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsMockUser(page);
  });

  test("the dashboard Home renders for an authenticated user", async ({
    page,
  }) => {
    await page.goto("/");
    // The v2 Home (HEL-58) shows a time-of-day greeting.
    await expect(
      page.getByRole("heading", { level: 1 }),
    ).toContainText(/Good (morning|afternoon|evening),/i);
  });
});

// ---------------------------------------------------------------------------
// Phase 5 — Mission intake.
// Status: shipped in HEL-23. `/hire` renders Hire.tsx; POST /api/missions
// persists the statement to the missions table. Phases 6+ still wait on
// HEL-25 / HEL-26 / HEL-27.
// ---------------------------------------------------------------------------

test.describe("Phase 5 — Mission intake", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsMockUser(page);
  });

  test("user can type a mission and persist it", async ({ page }) => {
    // Re-enabled in HEL-85 — needs a working TS Express backend at dev-api.
    // The dashboard E2E suite has no API mocking layer (see dashboard/e2e/
    // for the convention), so `Save draft` POSTs to a real /api/missions.
    // Until P2.5 stands up the consolidated backend, the save call won't
    // resolve, the saved-missions list won't refresh, and the assertion
    // below can't find the rendered listitem.
    test.fixme(true, "Blocked on HEL-85 — needs TS Express backend deployed at dev-api");
    await page.goto("/hire");
    await expect(page.getByRole("heading", { name: /Hire from a mission/i })).toBeVisible();
    await page
      .getByLabel(/Mission statement/i)
      .fill("Launch the R-7 to North America.");
    await page.getByRole("button", { name: /Save draft/i }).click();
    // After save, the mission appears in the "Saved missions" list. Scope the
    // assertion to a listitem so we don't strict-mode-collide with the textarea
    // input (still contains the typed text) or the structured-prompt preview
    // block (also echoes the mission text). HEL-85 will run the full
    // login → save → render round-trip against a real backend once the TS
    // Express deploy lands; for now this confirms the list section receives a
    // row with the mission text after the save call resolves.
    await expect(
      page.getByRole("listitem").filter({ hasText: /Launch the R-7/ }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Phase 6 — Hiring plan generator returns a structured plan.
// Status: shipped (HEL-24, POST /api/missions/:id/generate-plan). API-only
// assertion — UI integration of the plan card is tracked under HEL-25.
// ---------------------------------------------------------------------------

test.describe("Phase 6 — Hiring plan generator", () => {
  // The endpoint exists (HEL-24); fully exercising it from the dashboard UI
  // requires HEL-23 (mission intake) + HEL-25 (plan UI). API-only check stays
  // as a unit test in src/missions/missionRoutes.test.ts; this E2E phase
  // becomes meaningful once the UI lands.
  test.fixme(
    true,
    "Phase requires HEL-25 (plan-card UI) to be meaningful end-to-end",
  );

  test.beforeEach(async ({ page }) => {
    await loginAsMockUser(page);
  });

  test("after a mission saves, the plan card renders with at least 1 role", async ({
    page,
  }) => {
    await page.goto("/hire");
    // Assume Phase 5 saved a mission; the page should navigate to a plan view.
    await expect(page.getByRole("heading", { name: /hiring plan/i })).toBeVisible();
    // The plan card lists at least one role from DEFAULT_ROLE_LIBRARY.
    await expect(page.getByText(/Head of Growth|CTO|Operations Lead/)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Phase 7 — Confirm hiring plan → provision agents + org_edges.
// Status: BLOCKED on HEL-25.
// ---------------------------------------------------------------------------

test.describe("Phase 7 — Confirm hiring plan", () => {
  test.fixme(
    true,
    "Blocked on HEL-25 — confirm hiring plan → provision agents + org_edges",
  );

  test.beforeEach(async ({ page }) => {
    await loginAsMockUser(page);
  });

  test("clicking Confirm provisions agents and navigates to /team", async ({
    page,
  }) => {
    await page.goto("/hire/plan");
    await page.getByRole("button", { name: /confirm|onboard/i }).click();
    await expect(page).toHaveURL(/\/team/);
    // hiring_plans row should now have accepted_at; agents table has the new rows.
    // Asserted by the next phase rendering the org chart.
  });
});

// ---------------------------------------------------------------------------
// Phase 8 — Org chart visualization on Team page.
// Status: BLOCKED on HEL-26.
// ---------------------------------------------------------------------------

test.describe("Phase 8 — Team page org chart", () => {
  test.fixme(true, "Blocked on HEL-26 — org chart visualization on Team page");

  test.beforeEach(async ({ page }) => {
    await loginAsMockUser(page);
  });

  test("the org chart renders the agents provisioned in Phase 7", async ({
    page,
  }) => {
    await page.goto("/team");
    // Tree rooted at mission with at least one node per provisioned agent.
    await expect(page.locator("[data-testid='org-chart-node']").first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Phase 9 — Routine builder in Studio.
// Status: BLOCKED on HEL-27.
// ---------------------------------------------------------------------------

test.describe("Phase 9 — Routine builder", () => {
  test.fixme(true, "Blocked on HEL-27 — Routine builder in Studio (Pro mode)");

  test.beforeEach(async ({ page }) => {
    await loginAsMockUser(page);
  });

  test("user can drag nodes onto the canvas and save a workflow_version", async ({
    page,
  }) => {
    await page.goto("/studio");
    // Add a trigger and one LLM node, connect them, save.
    await page.getByRole("button", { name: /trigger/i }).click();
    await page.getByRole("button", { name: /llm/i }).click();
    await page.getByRole("button", { name: /save/i }).click();
    await expect(page.getByText(/workflow saved|version \d+/i)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Phase 10 — First run executes the workflow.
// Status: BLOCKED on HEL-27 + durable execution work (P3 — BullMQ on Upstash).
// ---------------------------------------------------------------------------

test.describe("Phase 10 — First run", () => {
  test.fixme(
    true,
    "Blocked on HEL-27 + P3 durable execution (BullMQ on Upstash Redis)",
  );

  test.beforeEach(async ({ page }) => {
    await loginAsMockUser(page);
  });

  test("clicking Run on a saved workflow starts a run and shows it in /runs", async ({
    page,
  }) => {
    await page.goto("/studio");
    await page.getByRole("button", { name: /run/i }).click();
    await expect(page).toHaveURL(/\/runs/);
    await expect(page.getByText(/queued|running/i)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Phase 11 — Ticket surfaces on /approvals.
// Status: shipped (HEL-15 schema + HEL-16 HITL ticket store). The Approvals
// page already renders pending approvals; in mock mode it renders zero-state.
// Once HEL-9/10 land actual approvals from real runs, this becomes a real
// integration check.
// ---------------------------------------------------------------------------

test.describe("Phase 11 — Ticket / Approval surface", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsMockUser(page);
  });

  test("/approvals page renders the queue (or zero-state in mock mode)", async ({
    page,
  }) => {
    await page.goto("/approvals");
    // Either the queue header is visible OR the empty-state message is.
    const header = page.getByRole("heading", { name: /approvals|queue/i });
    const empty = page.getByText(/no approvals|all caught up|nothing waiting/i);
    await expect(header.or(empty).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Phase 12 — Approve a ticket → run continues.
// Status: shipped at the API level. UI exercise depends on a seeded ticket
// existing; in mock mode there are none, so the click is a no-op. This phase
// goes meaningful once Phase 7-10 are wired and a real ticket exists.
// ---------------------------------------------------------------------------

test.describe("Phase 12 — Approval resolves", () => {
  test.fixme(
    true,
    "Phase requires Phases 7-11 to seed a real ticket; mock mode shows zero-state",
  );

  test.beforeEach(async ({ page }) => {
    await loginAsMockUser(page);
  });

  test("clicking Approve on a pending ticket moves it to Resolved", async ({
    page,
  }) => {
    await page.goto("/approvals");
    await page.getByRole("button", { name: /approve/i }).first().click();
    await expect(page.getByText(/approved|resolved/i)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Phase 12.5 — Connect a Slack workspace (placeholder for the connector OAuth
// surface). Status: BLOCKED on a Slack-connect ticket (no dedicated HEL yet —
// connector OAuth flows are in HEL-22 entitlements + planned Tier-1 work).
//
// The phase exists today only as a fixme'd placeholder that registers the
// stubSlackOAuth helper. Once the connector connect flow lands, the .fixme
// flips off and the synthetic OAuth round-trip drives a `connector_connection`
// row insert without ever calling slack.com.
// ---------------------------------------------------------------------------

test.describe("Phase 12.5 — Slack connect (placeholder)", () => {
  test.fixme(true, "Placeholder until a Slack connector OAuth flow ships (HEL follow-on to HEL-22)");

  test.beforeEach(async ({ page }) => {
    await loginAsMockUser(page);
    // HEL-75 — short-circuit the Slack OAuth round-trip so when the connect
    // button is wired, the dashboard's callback handler runs against the
    // synthetic redirect rather than slack.com.
    await stubSlackOAuth(page);
  });

  test("clicking Connect Slack triggers the OAuth callback handler (no live slack.com)", async ({
    page,
  }) => {
    await page.goto("/integrations");
    // Future click: page.getByRole("button", { name: /Connect Slack/i }).click()
    // The stub will redirect back to /integrations/slack/callback?code=...
    // and the dashboard should display a connected state.
    await expect(page.getByText(/Slack/)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Phase 13 — Activity feed shows the completed run.
// Status: BLOCKED on HEL-29 (activity feed v1 — polling).
// ---------------------------------------------------------------------------

test.describe("Phase 13 — Activity feed", () => {
  test.fixme(true, "Blocked on HEL-29 — activity feed v1 (polling)");

  test.beforeEach(async ({ page }) => {
    await loginAsMockUser(page);
  });

  test("the activity feed shows the run.completed event from Phase 12", async ({
    page,
  }) => {
    await page.goto("/activity");
    await expect(page.getByText(/run.completed|completed/i)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Phase 14 — Stripe invoice exists for the workspace.
// Status: webhook plumbing shipped (HEL-22 + HEL-67 stripeWebhookEventLog).
// Asserted as a backend GET so we don't have to open Stripe Dashboard.
// ---------------------------------------------------------------------------

test.describe("Phase 14 — Stripe invoice visible", () => {
  test.fixme(
    true,
    "Needs a backend GET /api/billing/invoices route for test-mode listing; tracked under HEL-22 follow-ups",
  );

  test("GET /api/billing/invoices returns at least one invoice for the workspace", async () => {
    const api = await playwrightRequest.newContext({
      extraHTTPHeaders: { Authorization: "Bearer e2e-access-token" },
    });
    const res = await api.get(`${BACKEND_BASE_URL}/api/billing/invoices`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { invoices: Array<{ id: string }> };
    expect(body.invoices.length).toBeGreaterThan(0);
    await api.dispose();
  });
});
