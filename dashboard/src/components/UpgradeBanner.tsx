/**
 * UpgradeBanner (HEL-270) — tier-aware status banner on the home dashboard.
 *
 * Renders one of 6 variants depending on the user's plan + wallet state:
 *   1. Free Explore tier, no cap   → "Upgrade now!" (primary, dismissible)
 *   2. Free Explore tier, cap hit  → "Upgrade to Flow" (warning, NOT dismissible)
 *   3. Paid tier, healthy balance  → renders nothing
 *   4. Paid tier, low balance      → "Top up credits" (info, dismissible)
 *   5. Paid tier, cap hit          → "Upgrade to {next}" (warning, NOT dismissible)
 *   6. Active promo                → promo copy + CTA (gradient, dismissible)
 *
 * Wired to TanStack-Query-backed data in `pages/Dashboard.tsx` so the
 * banner stays a pure presentation component — easy to test with mock
 * props. See `UpgradeBanner.test.tsx` for the per-variant coverage.
 *
 * Style template: components/OnboardingBanner.tsx (inline styles, af2-*
 * tokens, X dismiss button). Warning variant cribbed from
 * components/billing/CreditsPanel.tsx:73-89.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, AlertTriangle, ArrowRight, Tag, X, Zap } from "lucide-react";
import type { PricingTier } from "../api/pricingApi";
import type { WalletBalance } from "../api/creditsApi";

// ────────────────────────────────────────────────────────────────────────────
// Types

/**
 * Promo descriptor — rendering only in PR4. The source (env / DB / Sanity)
 * is intentionally not built; `promo = null` for everyone until a follow-up
 * ticket wires it up. Shape kept stable so the future PR doesn't need to
 * touch this file.
 */
export interface Promo {
  active: boolean;
  /** "all" matches every plan; tier-specific values match only that plan. */
  audience: "explore" | "flow" | "automate" | "scale" | "all";
  headline: string;
  ctaLabel: string;
  ctaUrl: string;
  expiresAt: string;
}

export interface UpgradeBannerProps {
  /** Current plan id; null while entitlements load. */
  plan: string | null;
  /** Wallet snapshot; null until the GET /credits/wallet/balance resolves. */
  wallet: WalletBalance | null;
  /** Pricing tiers from GET /api/public/landing/pricing; null until loaded. */
  tiers: PricingTier[] | null;
  /** Promo override; null = default upgrade/topup variants. */
  promo?: Promo | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Constants

/** Linear upgrade ladder. Scale's "next" is null → no banner above Scale. */
const NEXT_TIER: Record<string, string | null> = {
  explore: "flow",
  flow: "automate",
  automate: "scale",
  scale: null,
};

/**
 * Tier-name accent color, used on the inline tier badge. Matches the
 * spec (Explore=gray, Flow=blue, Automate=purple, Scale=gold) using the
 * af2-* design tokens shared with the landing.
 */
const TIER_TINT: Record<string, string> = {
  explore: "var(--af2-ink-3, #6b5a48)",
  flow: "var(--af2-ink-blue, #1f3a52)",
  automate: "var(--af2-plum, #5d3a5e)",
  scale: "var(--af2-mustard, #b8862c)",
};

const DISMISS_KEY_PREFIX = "af2-upgrade-banner-dismissed";

// TODO(promo-source): Wire promo data from a real source (env / DB / Sanity).
// Until then, every consumer passes `promo = null` and the variant table
// below never picks the promo row.

// ────────────────────────────────────────────────────────────────────────────
// Variant resolution

type Variant =
  | { kind: "none" }
  | {
      kind: "primary";
      copy: string;
      ctaLabel: string;
      ctaHref: string;
      dismissible: true;
      stateKey: string;
      tierBadge?: { id: string; label: string };
    }
  | {
      kind: "warning";
      copy: string;
      ctaLabel: string;
      ctaHref: string;
      dismissible: false;
      stateKey: string;
      tierBadge?: { id: string; label: string };
    }
  | {
      kind: "info";
      copy: string;
      ctaLabel: string;
      ctaHref: string;
      dismissible: true;
      stateKey: string;
      tierBadge?: { id: string; label: string };
    }
  | {
      kind: "promo";
      copy: string;
      ctaLabel: string;
      ctaHref: string;
      dismissible: true;
      stateKey: string;
    };

function resolveTier(tiers: PricingTier[] | null, id: string | null): PricingTier | null {
  if (!tiers || !id) return null;
  return tiers.find((t) => t.id === id) ?? null;
}

function priceLabel(tier: PricingTier | null): string {
  if (!tier) return "";
  if (tier.priceUsdCents === 0) return "free";
  return `$${Math.round(tier.priceUsdCents / 100)}${tier.priceUnit || "/mo"}`;
}

function nextTierUpgradeCopy(nextId: string, nextTier: PricingTier | null): string {
  if (!nextTier) return `Upgrade to ${nextId.charAt(0).toUpperCase() + nextId.slice(1)}`;
  return `Upgrade to ${nextTier.displayName} ${priceLabel(nextTier)}`.trim();
}

export function resolveVariant(props: UpgradeBannerProps): Variant {
  const { plan, wallet, tiers, promo } = props;

  // 1. Promo wins when active + audience matches the current tier.
  if (promo?.active && plan && (promo.audience === "all" || promo.audience === plan)) {
    return {
      kind: "promo",
      copy: promo.headline,
      ctaLabel: promo.ctaLabel,
      ctaHref: promo.ctaUrl,
      dismissible: true,
      stateKey: "promo",
    };
  }

  // 2. Still loading — show nothing.
  if (plan === null) {
    return { kind: "none" };
  }

  const capHit = Boolean(wallet?.dailyCapStatus?.capReached);
  const lowBalance = Boolean(wallet?.lowBalance);
  const isPaid = plan !== "explore";

  // 3. Daily cap reached — warning, non-dismissible, suggests next tier.
  if (capHit) {
    const nextId = NEXT_TIER[plan];
    if (!nextId) {
      // Already on Scale — cap hit but nowhere to upgrade to. Surface a
      // top-up CTA instead so the user has something to act on.
      return {
        kind: "warning",
        copy: "Daily Scale credit cap reached. Top up credits to keep your agents running.",
        ctaLabel: "Buy credits",
        ctaHref: "/billing#credits",
        dismissible: false,
        stateKey: `cap-${plan}`,
        tierBadge: { id: plan, label: "Scale" },
      };
    }
    const nextTier = resolveTier(tiers, nextId);
    const tierDisplay = resolveTier(tiers, plan)?.displayName ?? capitalize(plan);
    const copy =
      plan === "explore"
        ? `Daily Explore credit cap reached. Upgrade to Flow for 5,000 daily credits.`
        : `Daily ${tierDisplay} credit cap reached. Upgrade to ${nextTier?.displayName ?? capitalize(nextId)}.`;
    return {
      kind: "warning",
      copy,
      ctaLabel: nextTierUpgradeCopy(nextId, nextTier),
      ctaHref: `/billing?tier=${nextId}`,
      dismissible: false,
      stateKey: `cap-${plan}`,
      tierBadge: { id: plan, label: tierDisplay },
    };
  }

  // 4. Free Explore tier (no cap hit yet) — primary upgrade prompt.
  if (plan === "explore") {
    return {
      kind: "primary",
      copy: "You're on the free Explore tier. Upgrade now!",
      ctaLabel: "Upgrade plan",
      ctaHref: "/billing",
      dismissible: true,
      stateKey: "explore-default",
      tierBadge: { id: "explore", label: "Explore" },
    };
  }

  // 5. Paid tier, low balance — info nudge to top up.
  if (isPaid && lowBalance) {
    return {
      kind: "info",
      copy: "Credits running low — top up to keep your agents running.",
      ctaLabel: "Buy credits",
      ctaHref: "/billing#credits",
      dismissible: true,
      stateKey: `low-balance-${plan}`,
      tierBadge: { id: plan, label: resolveTier(tiers, plan)?.displayName ?? capitalize(plan) },
    };
  }

  // 6. Paid tier, healthy balance — nothing to show.
  return { kind: "none" };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// ────────────────────────────────────────────────────────────────────────────
// Component

export function UpgradeBanner(props: UpgradeBannerProps) {
  const variant = resolveVariant(props);

  const dismissKey =
    variant.kind !== "none" && variant.dismissible
      ? `${DISMISS_KEY_PREFIX}-${variant.stateKey}-${todayKey()}`
      : null;

  const [dismissed, setDismissed] = useState<boolean>(() =>
    dismissKey ? readDismissed(dismissKey) : false,
  );

  if (variant.kind === "none" || dismissed) return null;

  function handleDismiss(): void {
    if (!dismissKey) return;
    setDismissed(true);
    try {
      window.localStorage.setItem(dismissKey, "1");
    } catch {
      // Quota / private-mode failures are fine — stays hidden via state.
    }
  }

  const palette = variantPalette(variant.kind);

  return (
    <div
      role={variant.kind === "warning" ? "alert" : "region"}
      aria-label="Upgrade banner"
      style={{
        position: "relative",
        marginBottom: 22,
        padding: "16px 20px",
        paddingRight: variant.dismissible ? 44 : 20,
        borderRadius: 14,
        background: palette.background,
        border: `1px solid ${palette.border}`,
        color: palette.foreground,
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          borderRadius: 8,
          background: palette.iconBackground,
          color: palette.iconForeground,
          flexShrink: 0,
        }}
      >
        <VariantIcon kind={variant.kind} />
      </span>

      <div style={{ flex: "1 1 240px", minWidth: 0 }}>
        {variant.kind !== "promo" && variant.tierBadge ? (
          <div style={{ marginBottom: 4 }}>
            <span
              className="af2-eyebrow"
              style={{
                color: TIER_TINT[variant.tierBadge.id] ?? "var(--af2-ink-3)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {variant.tierBadge.label} tier
            </span>
          </div>
        ) : null}
        <div style={{ fontSize: 14, lineHeight: 1.45, fontWeight: 500 }}>
          {variant.copy}
        </div>
      </div>

      <Link
        to={variant.ctaHref}
        className="af2-btn af2-btn-clay"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
        }}
      >
        {variant.ctaLabel}
        <ArrowRight size={14} aria-hidden="true" />
      </Link>

      {variant.dismissible ? (
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss upgrade banner"
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            border: "none",
            background: "transparent",
            padding: 6,
            color: palette.foreground,
            opacity: 0.6,
            cursor: "pointer",
            borderRadius: 6,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = "1";
            e.currentTarget.style.background = "rgba(0,0,0,0.06)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = "0.6";
            e.currentTarget.style.background = "transparent";
          }}
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers

function VariantIcon({ kind }: { kind: Exclude<Variant["kind"], "none"> }) {
  switch (kind) {
    case "primary":
      return <Zap size={16} />;
    case "warning":
      return <AlertTriangle size={16} />;
    case "info":
      return <AlertCircle size={16} />;
    case "promo":
      return <Tag size={16} />;
  }
}

interface Palette {
  background: string;
  border: string;
  foreground: string;
  iconBackground: string;
  iconForeground: string;
}

function variantPalette(kind: Exclude<Variant["kind"], "none">): Palette {
  switch (kind) {
    case "primary":
      return {
        background: "linear-gradient(135deg, rgba(93,58,94,0.10), rgba(192,84,76,0.08))",
        border: "rgba(93,58,94,0.30)",
        foreground: "var(--af2-ink)",
        iconBackground: "var(--af2-plum, #5d3a5e)",
        iconForeground: "var(--af2-paper, #f6f1e7)",
      };
    case "warning":
      return {
        background: "rgba(194,80,43,0.10)",
        border: "var(--af2-clay, #c2502b)",
        foreground: "var(--af2-clay, #c2502b)",
        iconBackground: "var(--af2-clay, #c2502b)",
        iconForeground: "var(--af2-paper, #f6f1e7)",
      };
    case "info":
      return {
        background: "rgba(31,58,82,0.08)",
        border: "rgba(31,58,82,0.30)",
        foreground: "var(--af2-ink)",
        iconBackground: "var(--af2-ink-blue, #1f3a52)",
        iconForeground: "var(--af2-paper, #f6f1e7)",
      };
    case "promo":
      return {
        background: "linear-gradient(135deg, rgba(184,134,44,0.14), rgba(192,84,76,0.10))",
        border: "rgba(184,134,44,0.40)",
        foreground: "var(--af2-ink)",
        iconBackground: "var(--af2-mustard, #b8862c)",
        iconForeground: "var(--af2-paper, #f6f1e7)",
      };
  }
}

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function readDismissed(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

// Exported for tests + the rare case we want to programmatically re-surface
// the banner (e.g. a "Show banner again" link in Settings).
export const UPGRADE_BANNER_DISMISS_PREFIX = DISMISS_KEY_PREFIX;
