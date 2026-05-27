/**
 * UpgradeBanner (HEL-270) tests — one assertion per variant outcome plus
 * dismissal persistence. The banner is presentation-only, so no network
 * mocks needed; we drive it via props.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { UpgradeBanner, type UpgradeBannerProps } from "./UpgradeBanner";
import type { PricingTier } from "../api/pricingApi";
import type { WalletBalance } from "../api/creditsApi";

const TIERS: PricingTier[] = [
  { id: "explore",  displayName: "Explore",  priceUsdCents: 0,    currency: "usd", trialDays: 0,  sortOrder: 10, isPopular: false, features: [], ctaLabel: "Get started",       priceUnit: "/mo" },
  { id: "flow",     displayName: "Flow",     priceUsdCents: 1900, currency: "usd", trialDays: 14, sortOrder: 20, isPopular: false, features: [], ctaLabel: "Start 14-day trial", priceUnit: "/mo" },
  { id: "automate", displayName: "Automate", priceUsdCents: 4900, currency: "usd", trialDays: 14, sortOrder: 30, isPopular: true,  features: [], ctaLabel: "Start 14-day trial", priceUnit: "/seat/mo" },
  { id: "scale",    displayName: "Scale",    priceUsdCents: 9900, currency: "usd", trialDays: 0,  sortOrder: 40, isPopular: false, features: [], ctaLabel: "Choose Scale",       priceUnit: "/seat/mo" },
];

function mkWallet(overrides: Partial<WalletBalance> = {}): WalletBalance {
  return {
    balanceCredits: "100000",
    lifetimePurchasedCredits: "500000",
    lifetimeConsumedCredits: "400000",
    autoTopupEnabled: false,
    ...overrides,
  };
}

function renderBanner(props: Partial<UpgradeBannerProps> = {}) {
  const merged: UpgradeBannerProps = {
    plan: "explore",
    wallet: mkWallet(),
    tiers: TIERS,
    promo: null,
    ...props,
  };
  return render(
    <MemoryRouter>
      <UpgradeBanner {...merged} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("UpgradeBanner", () => {
  it("renders nothing while plan is still loading (plan === null)", () => {
    const { container } = renderBanner({ plan: null });
    expect(container.firstChild).toBeNull();
  });

  it("renders the primary Explore upgrade variant when plan === 'explore' and no cap is hit", () => {
    renderBanner({ plan: "explore" });
    expect(
      screen.getByText("You're on the free Explore tier. Upgrade now!"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Upgrade plan/i })).toHaveAttribute(
      "href",
      "/billing",
    );
    expect(screen.getByRole("button", { name: /Dismiss upgrade banner/i })).toBeInTheDocument();
  });

  it("renders the cap-hit warning when plan === 'explore' and daily cap is reached, and is NOT dismissible", () => {
    renderBanner({
      plan: "explore",
      wallet: mkWallet({
        dailyCapStatus: { cap: "1000", consumedToday: "1000", capReached: true },
      }),
    });
    expect(
      screen.getByText(
        /Daily Explore credit cap reached. Upgrade to Flow for 5,000 daily credits./i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Upgrade to Flow/i })).toHaveAttribute(
      "href",
      "/billing?tier=flow",
    );
    expect(screen.queryByRole("button", { name: /Dismiss upgrade banner/i })).toBeNull();
  });

  it("renders nothing when a paid tier has a healthy balance and no cap hit", () => {
    const { container } = renderBanner({
      plan: "flow",
      wallet: mkWallet({ lowBalance: false }),
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders the info top-up variant when a paid tier has lowBalance === true", () => {
    renderBanner({
      plan: "flow",
      wallet: mkWallet({ lowBalance: true }),
    });
    expect(
      screen.getByText(/Credits running low — top up to keep your agents running./i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Buy credits/i })).toHaveAttribute(
      "href",
      "/billing#credits",
    );
  });

  it("renders the cap-hit warning for a paid tier with a next-tier upgrade CTA", () => {
    renderBanner({
      plan: "automate",
      wallet: mkWallet({
        dailyCapStatus: { cap: "20000", consumedToday: "20000", capReached: true },
      }),
    });
    expect(
      screen.getByText(/Daily Automate credit cap reached. Upgrade to Scale./i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Upgrade to Scale/i })).toHaveAttribute(
      "href",
      "/billing?tier=scale",
    );
    expect(screen.queryByRole("button", { name: /Dismiss upgrade banner/i })).toBeNull();
  });

  it("falls back to Buy credits when the Scale tier hits the cap (no next tier)", () => {
    renderBanner({
      plan: "scale",
      wallet: mkWallet({
        dailyCapStatus: { cap: "100000", consumedToday: "100000", capReached: true },
      }),
    });
    expect(
      screen.getByText(/Daily Scale credit cap reached. Top up credits/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Buy credits/i })).toHaveAttribute(
      "href",
      "/billing#credits",
    );
  });

  it("renders the promo variant when an active promo matches the user's audience", () => {
    renderBanner({
      plan: "flow",
      promo: {
        active: true,
        audience: "flow",
        headline: "20% off Automate this week",
        ctaLabel: "Claim discount",
        ctaUrl: "/billing?tier=automate&promo=AUTUMN20",
        expiresAt: "2099-01-01T00:00:00Z",
      },
    });
    expect(screen.getByText("20% off Automate this week")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Claim discount/i })).toHaveAttribute(
      "href",
      "/billing?tier=automate&promo=AUTUMN20",
    );
  });

  it("ignores a promo whose audience does not match the user's plan", () => {
    renderBanner({
      plan: "automate",
      wallet: mkWallet(),
      promo: {
        active: true,
        audience: "flow",
        headline: "Flow-only discount",
        ctaLabel: "Claim",
        ctaUrl: "/billing?promo=FLOWONLY",
        expiresAt: "2099-01-01T00:00:00Z",
      },
    });
    // Paid tier with healthy balance + non-matching promo → renders nothing.
    expect(screen.queryByText("Flow-only discount")).toBeNull();
  });

  it("dismisses to localStorage and stays hidden on re-render", async () => {
    const user = userEvent.setup();
    const { unmount } = renderBanner({ plan: "explore" });
    await user.click(screen.getByRole("button", { name: /Dismiss upgrade banner/i }));
    expect(
      screen.queryByText("You're on the free Explore tier. Upgrade now!"),
    ).toBeNull();
    // Persisted across remount.
    unmount();
    renderBanner({ plan: "explore" });
    expect(
      screen.queryByText("You're on the free Explore tier. Upgrade now!"),
    ).toBeNull();
  });
});
