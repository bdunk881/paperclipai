/**
 * HEL-75 — sanity coverage for the Playwright network-stub helpers.
 *
 * The helpers live in dashboard/e2e/helpers/networkStubs.ts and are imported
 * by golden-path.spec.ts. They take a Playwright Page object and register
 * page.route() handlers — we can't exercise the actual Page API here
 * (Playwright isn't loaded in vitest), but we can:
 *
 *   1. Assert the helper signature matches what golden-path.spec.ts calls.
 *   2. Assert the helper registers a route() with the expected glob.
 *   3. Assert the route handler returns the right shape given a sample
 *      request (Stripe → JSON with {url}, Slack → 302 to redirect_uri+code).
 *
 * We do this by passing a minimal Page-shaped stub that captures whatever
 * the helper passes to page.route(). The captured handler is then invoked
 * with a synthetic Playwright Route to verify the fulfill payload.
 */

import { describe, expect, it, vi } from "vitest";
import {
  stubSlackOAuth,
  stubStripeCheckoutApi,
} from "../../e2e/helpers/networkStubs";

interface CapturedRoute {
  pattern: string | RegExp;
  handler: (route: SyntheticRoute) => Promise<void>;
}

interface SyntheticRoute {
  request: () => { url: () => string };
  fulfill: (payload: {
    status?: number;
    contentType?: string;
    body?: string;
    headers?: Record<string, string>;
  }) => Promise<void>;
}

function makePage(): { page: { route: ReturnType<typeof vi.fn> }; captured: CapturedRoute[] } {
  const captured: CapturedRoute[] = [];
  const route = vi.fn(
    async (pattern: string | RegExp, handler: (route: SyntheticRoute) => Promise<void>) => {
      captured.push({ pattern, handler });
    },
  );
  return { page: { route }, captured };
}

describe("stubStripeCheckoutApi (HEL-75)", () => {
  it("registers a route for the backend checkout endpoint", async () => {
    const { page, captured } = makePage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await stubStripeCheckoutApi(page as any, "http://localhost:5173");
    expect(captured).toHaveLength(1);
    expect(String(captured[0].pattern)).toMatch(
      /\/api\/public\/landing\/checkout/,
    );
  });

  it("fulfills with a JSON body containing the dashboard success URL", async () => {
    const { page, captured } = makePage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await stubStripeCheckoutApi(page as any, "http://localhost:5173");

    const fulfill = vi.fn(async () => {});
    const route: SyntheticRoute = {
      request: () => ({
        url: () => "http://localhost:8000/api/public/landing/checkout",
      }),
      fulfill: fulfill as SyntheticRoute["fulfill"],
    };
    await captured[0].handler(route);

    expect(fulfill).toHaveBeenCalledTimes(1);
    const call = fulfill.mock.calls[0]?.[0] as {
      status: number;
      contentType: string;
      body: string;
    };
    expect(call.status).toBe(200);
    expect(call.contentType).toBe("application/json");
    const body = JSON.parse(call.body) as { url: string };
    expect(body.url).toBe(
      "http://localhost:5173/checkout/success?session_id=cs_test_golden_path",
    );
  });

  it("trims trailing slashes from the dashboard base URL", async () => {
    const { page, captured } = makePage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await stubStripeCheckoutApi(page as any, "http://localhost:5173/");

    const fulfill = vi.fn(async () => {});
    await captured[0].handler({
      request: () => ({
        url: () => "http://localhost:8000/api/public/landing/checkout",
      }),
      fulfill: fulfill as SyntheticRoute["fulfill"],
    });

    const body = JSON.parse(
      (fulfill.mock.calls[0]?.[0] as { body: string }).body,
    ) as { url: string };
    // No double slash.
    expect(body.url).toBe(
      "http://localhost:5173/checkout/success?session_id=cs_test_golden_path",
    );
  });
});

describe("stubSlackOAuth (HEL-75)", () => {
  it("registers a route for slack.com/oauth/v2/authorize", async () => {
    const { page, captured } = makePage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await stubSlackOAuth(page as any);
    expect(captured).toHaveLength(1);
    expect(String(captured[0].pattern)).toMatch(
      /slack\.com\/oauth\/v2\/authorize/,
    );
  });

  it("302-redirects to the redirect_uri with a synthetic code + preserved state", async () => {
    const { page, captured } = makePage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await stubSlackOAuth(page as any);

    const fulfill = vi.fn(async () => {});
    const route: SyntheticRoute = {
      request: () => ({
        url: () =>
          "https://slack.com/oauth/v2/authorize?client_id=xxx&redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fintegrations%2Fslack%2Fcallback&state=opaque-xyz",
      }),
      fulfill: fulfill as SyntheticRoute["fulfill"],
    };
    await captured[0].handler(route);

    expect(fulfill).toHaveBeenCalledTimes(1);
    const call = fulfill.mock.calls[0]?.[0] as {
      status: number;
      headers: Record<string, string>;
    };
    expect(call.status).toBe(302);
    const location = new URL(call.headers.Location);
    expect(location.origin + location.pathname).toBe(
      "http://localhost:5173/integrations/slack/callback",
    );
    expect(location.searchParams.get("code")).toBe(
      "slack_test_authorization_code",
    );
    expect(location.searchParams.get("state")).toBe("opaque-xyz");
  });

  it("returns 400 when redirect_uri is missing", async () => {
    const { page, captured } = makePage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await stubSlackOAuth(page as any);

    const fulfill = vi.fn(async () => {});
    await captured[0].handler({
      request: () => ({
        url: () => "https://slack.com/oauth/v2/authorize?client_id=xxx",
      }),
      fulfill: fulfill as SyntheticRoute["fulfill"],
    });

    const call = fulfill.mock.calls[0]?.[0] as { status: number };
    expect(call.status).toBe(400);
  });
});
