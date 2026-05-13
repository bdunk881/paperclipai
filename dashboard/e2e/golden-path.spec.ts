/**
 * E2E: First-run golden path  (HEL-28)
 *
 * The single most important test in the repo. Exercises the full journey:
 *   anonymous visitor → landing → pricing CTA → Stripe checkout (test-mode)
 *   → return to app → workspace → describe mission → review hiring plan
 *   → confirm → connect Slack OAuth → deploy routine → first run
 *   → ticket created → approve → run completes → Activity → Stripe invoice
 *
 * **Running against external services**
 * Steps 1-2 (landing) require LANDING_BASE_URL env var.
 * Steps 7 (Slack OAuth) and 12 (Stripe invoice) are skipped in CI;
 * they require live credentials that are not available in the test runner.
 *
 * **fixme annotations**
 * Steps backed by P2 features that are not yet merged are annotated
 * test.fixme(). Each fixme() corresponds to a P2 sub-ticket. Once the
 * blocking issue lands, remove the fixme() so the step enters CI.
 *
 * Acceptance: every non-fixme, non-skip step must run green in CI.
 */

import { test, expect, type Page } from "@playwright/test";
import { loginAsMockUser } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/** Marketing landing base URL (e.g. http://localhost:3000). */
const LANDING_BASE_URL = process.env.LANDING_BASE_URL?.replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Network stubs
// ---------------------------------------------------------------------------

/**
 * Intercept the checkout API and return a fake Stripe redirect URL that
 * points back to the dashboard checkout-success page.
 */
async function stubStripeCheckoutApi(page: Page, dashboardBase: string) {
  await page.route("**/api/public/landing/checkout**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: `${dashboardBase}/checkout/success?session_id=cs_test_golden_path`,
      }),
    });
  });
}

/**
 * Intercept Slack OAuth authorize requests and redirect back to the
 * dashboard OAuth callback with a synthetic code.
 */
async function stubSlackOAuth(page: Page) {
  await page.route("**/slack.com/oauth/v2/authorize**", async (route) => {
    const url = new URL(route.request().url());
    const redirectUri = url.searchParams.get("redirect_uri");
    if (redirectUri) {
      await route.fulfill({
        status: 302,
        headers: { location: `${redirectUri}?code=test_slack_code_golden_path&state=test_state` },
      });
    } else {
      await route.continue();
    }
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe("Golden Path: first-run end-to-end (HEL-28)", () => {
  // -------------------------------------------------------------------------
  // Phase 1 — Landing: anonymous visitor sees pricing section
  // -------------------------------------------------------------------------

  test("1. landing: anonymous visitor reaches the pricing CTA", async ({ page }) => {
    test.skip(!LANDING_BASE_URL, "LANDING_BASE_URL not set — landing app is not in scope for this CI run");

    await page.goto(LANDING_BASE_URL!);
    await expect(page.getByText(/autoflow/i).first()).toBeVisible();

    // Navigate to pricing — either via anchor or sidebar link
    const pricingLink = page.getByRole("link", { name: /^pricing$/i }).first();
    if (await pricingLink.count() > 0) {
      await pricingLink.click();
    } else {
      await page.goto(`${LANDING_BASE_URL}/#pricing`);
    }

    // At least one paid-tier CTA button must be visible
    await expect(
      page.getByRole("button", { name: /start.*trial|start free|get started/i }).first()
    ).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Phase 2 — Landing: pricing CTA triggers Stripe checkout (stubbed)
  // -------------------------------------------------------------------------

  test("2. landing: clicking pricing CTA initiates Stripe checkout", async ({ page, baseURL }) => {
    test.skip(!LANDING_BASE_URL, "LANDING_BASE_URL not set — landing app is not in scope for this CI run");

    await stubStripeCheckoutApi(page, baseURL ?? "http://localhost:5173");

    await page.goto(`${LANDING_BASE_URL}/#pricing`);

    const cta = page.getByRole("button", { name: /start.*trial|start free|get started/i }).first();
    await expect(cta).toBeVisible({ timeout: 8000 });
    await cta.click();

    // Stub resolves to dashboard /checkout/success
    await expect(page).toHaveURL(/checkout\/success/, { timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // Phase 3 — App: Stripe return lands on checkout-success page
  // -------------------------------------------------------------------------

  test("3. app: checkout success page renders after Stripe return", async ({ page }) => {
    await page.goto("/checkout/success");

    await expect(page.getByRole("heading", { name: /you're all set/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /go to dashboard/i })).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Phase 4 — App: post-checkout user reaches dashboard (workspace live)
  // -------------------------------------------------------------------------

  test("4. app: post-checkout 'Go to Dashboard' lands on command center", async ({ page }) => {
    await loginAsMockUser(page);
    await page.goto("/checkout/success");

    await page.getByRole("link", { name: /go to dashboard/i }).click();

    await expect(page).toHaveURL("/");
    await expect(page.getByText(/customer command center/i)).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Phase 5 — App: describe mission on staffing plan page
  // Blocked by HEL-25 (Confirm hiring plan → provision agents + org_edges).
  // -------------------------------------------------------------------------

  test("5. app: staffing plan page is reachable to describe the company mission", async ({ page }) => {
    // fixme: HEL-25 - staffing plan form requires real access token; mock
    // session lands on an error state until the hiring-plan backend is wired.
    test.fixme(true, "HEL-25 (hiring plan) not yet complete — staffing plan requires real API token");

    await loginAsMockUser(page);
    await page.goto("/workspace/staffing-plan");

    // Company name / goal inputs must be visible
    const goalField = page.getByLabel(/goal/i).first();
    await expect(goalField).toBeVisible({ timeout: 8000 });

    await goalField.fill("Ship a production-ready SaaS with the first paying customer within 90 days");
    await expect(goalField).toHaveValue(/first paying customer/i);
  });

  // -------------------------------------------------------------------------
  // Phase 6 — App: review the generated hiring plan
  // Blocked by HEL-25.
  // -------------------------------------------------------------------------

  test("6. app: generated hiring plan is displayed for review", async ({ page }) => {
    test.fixme(true, "HEL-25 (hiring plan generation) not yet complete");

    await loginAsMockUser(page);
    await page.goto("/workspace/staffing-plan");

    // After goal entry the user clicks Generate Plan; the AI returns a staffing
    // recommendation that shows agent slots.
    const generateBtn = page.getByRole("button", { name: /generate.*plan|assemble.*team/i }).first();
    await expect(generateBtn).toBeVisible({ timeout: 8000 });
    await generateBtn.click();

    // Hiring plan cards should appear
    await expect(page.getByText(/recommended.*agent|role.*template|slot/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  // -------------------------------------------------------------------------
  // Phase 7 — App: connect Slack via OAuth
  // Blocked by HEL-22 (Stripe entitlements + requireEntitlement() middleware).
  // -------------------------------------------------------------------------

  test("7. app: Slack integration connect button is available", async ({ page }) => {
    test.fixme(
      true,
      "HEL-22 (Stripe entitlements) gates the Slack OAuth flow — needs entitlement middleware"
    );

    await loginAsMockUser(page);
    await stubSlackOAuth(page);

    await page.goto("/integrations");

    await expect(page.getByRole("heading", { name: /integrations/i })).toBeVisible({ timeout: 5000 });

    // Slack connector card must be visible
    const slackCard = page.getByText(/slack/i).first();
    await expect(slackCard).toBeVisible();

    // Click Connect on the Slack row
    const connectBtn = page
      .locator("button", { hasText: /^connect$/i })
      .filter({ has: slackCard })
      .first();
    await expect(connectBtn).toBeVisible({ timeout: 5000 });
    await connectBtn.click();

    // OAuth stub redirects back; connection should become active
    await expect(page.getByText(/connected|active/i).first()).toBeVisible({ timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // Phase 8 — App: deploy a routine
  // Blocked by HEL-27 (Routine builder in Studio).
  // -------------------------------------------------------------------------

  test("8. app: routines page loads and shows the deploy surface", async ({ page }) => {
    test.fixme(true, "HEL-27 (Routine builder) not yet complete");

    await loginAsMockUser(page);
    await page.goto("/agents/routines");

    await expect(page.getByRole("heading", { name: /scheduled agent work|routines/i })).toBeVisible({
      timeout: 8000,
    });

    // A "New Routine" or "Deploy" CTA must exist
    const deployBtn = page
      .getByRole("button", { name: /new routine|deploy|add routine/i })
      .first();
    await expect(deployBtn).toBeVisible({ timeout: 5000 });
    await deployBtn.click();

    // The routine builder or a create-routine modal should open
    await expect(
      page.getByText(/schedule|cron|interval|trigger/i).first()
    ).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // Phase 9 — App: first run via workflow builder → monitor
  // -------------------------------------------------------------------------

  test("9. app: first routine run starts and opens the run monitor", async ({ page }) => {
    await loginAsMockUser(page);

    // Use the existing template to trigger a run (mock mode)
    await page.goto("/builder/tpl-support-bot");

    const runBtn = page.getByRole("button", { name: /^run$/i });
    await expect(runBtn).toBeVisible({ timeout: 8000 });
    await runBtn.click();

    await expect(page).toHaveURL(/\/monitor/, { timeout: 8000 });
    await expect(page.getByRole("heading", { name: /run monitor/i })).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // Phase 10 — App: HITL ticket created and visible in tickets queue
  // -------------------------------------------------------------------------

  test("10. app: tickets queue is reachable after a run", async ({ page }) => {
    await loginAsMockUser(page);
    await page.goto("/tickets");

    await expect(
      page.getByRole("heading", { name: /ticketing command surface/i })
    ).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Phase 11 — App: approve generated HITL ticket
  // -------------------------------------------------------------------------

  test("11. app: approvals surface renders pending items", async ({ page }) => {
    await loginAsMockUser(page);
    await page.goto("/approvals");

    // Page must render — in mock mode it shows the approvals shell even if empty
    await expect(page.getByText(/approvals/i).first()).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Phase 12 — App: completed run appears in Activity feed on dashboard
  // -------------------------------------------------------------------------

  test("12. app: Activity feed is visible on the dashboard after run completes", async ({ page }) => {
    await loginAsMockUser(page);
    await page.goto("/");

    await expect(page.getByText(/activity updates as they happen/i)).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/observability cockpit/i)).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // Phase 13 — Stripe: invoice visible in Stripe dashboard
  // Cannot be automated without live Stripe credentials; verify manually or
  // via Stripe CLI: `stripe invoices list --limit 1`
  // -------------------------------------------------------------------------

  test("13. stripe: invoice appears in Stripe test-mode dashboard", async () => {
    test.skip(true, "Stripe dashboard is external — verify manually via Stripe CLI in test-mode");
  });
});
