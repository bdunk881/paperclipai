/**
 * Playwright network stubs for the golden-path spec (HEL-75).
 *
 * The golden path crosses several third-party hops we don't want to hit in
 * CI (real Stripe Checkout, real Slack OAuth). These helpers install
 * `page.route()` interceptors that short-circuit those hops with predictable
 * synthetic responses so the test focuses on the dashboard's own behavior
 * instead of the third party.
 *
 * Each helper is a no-op against any test that hasn't called it — they're
 * additive, so call them in `test.beforeEach` of the phase that needs them.
 */

import type { Page } from "@playwright/test";

/**
 * Intercept the backend's `/api/public/landing/checkout` endpoint and
 * return a fake Stripe Checkout redirect URL that points back to the
 * dashboard's `/checkout/success` route with a synthetic session id.
 *
 * Phase 2 (pricing CTA) needs this to assert the post-Stripe redirect
 * without exercising a live test-mode Stripe session.
 *
 * Usage:
 *   test.beforeEach(async ({ page }) => {
 *     await stubStripeCheckoutApi(page, "http://localhost:5173");
 *   });
 *
 * @param page - Playwright page object the test is using.
 * @param dashboardBase - Base URL the success redirect should point at.
 *   E.g. "http://localhost:5173" in local dev, the CF Pages preview URL in CI.
 */
export async function stubStripeCheckoutApi(
  page: Page,
  dashboardBase: string,
): Promise<void> {
  await page.route("**/api/public/landing/checkout**", async (route) => {
    // The endpoint normally returns { url: "https://checkout.stripe.com/..." }.
    // We point it back at /checkout/success?session_id=... so the dashboard's
    // post-checkout flow (entitlement reconcile, redirect to /) runs against
    // the real success page without a live Stripe round-trip.
    const url = `${dashboardBase.replace(/\/$/, "")}/checkout/success?session_id=cs_test_golden_path`;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url }),
    });
  });
}

/**
 * Intercept the Slack OAuth authorize URL and 302-redirect back to the
 * `redirect_uri` query parameter with a synthetic `code` so the dashboard's
 * Slack-connect callback handler runs without hitting Slack at all.
 *
 * Phase 9-11 (Slack connect once HEL-22 + connector OAuth lands) will use
 * this. The helper is shipped now so flipping the `test.fixme()` off is
 * the only edit needed when the underlying ticket merges.
 *
 * @param page - Playwright page object.
 */
export async function stubSlackOAuth(page: Page): Promise<void> {
  await page.route("**/slack.com/oauth/v2/authorize**", async (route) => {
    const requestUrl = route.request().url();
    const parsed = new URL(requestUrl);
    const redirectUri = parsed.searchParams.get("redirect_uri");
    const state = parsed.searchParams.get("state") ?? "";
    if (!redirectUri) {
      // Slack would reject anyway; mirror that so the dashboard sees the
      // expected error path.
      await route.fulfill({
        status: 400,
        contentType: "text/plain",
        body: "missing redirect_uri",
      });
      return;
    }

    const callback = new URL(redirectUri);
    callback.searchParams.set("code", "slack_test_authorization_code");
    if (state) callback.searchParams.set("state", state);

    await route.fulfill({
      status: 302,
      headers: {
        Location: callback.toString(),
      },
      body: "",
    });
  });
}
