/**
 * AutoFlow v2 landing — HEL-33.
 *
 * Editorial port of `Projects/AutoFlow/v2/AutoFlow Landing.html`. Design
 * tokens + the `.lp-*` / `.af2-*` classes live in `./v2.css`. Real form
 * submissions hit the Express backend via `buildLandingApiUrl()`
 * (see `landing/lib/publicApi.ts`).
 */

import { Link, useLoaderData } from "react-router";
import { useEffect, useState } from "react";
import { CompanyLogo } from "@autoflow/logo-dev";
import { buildLandingApiUrl } from "@/lib/publicApi";
import {
  CountUp,
  InView,
  Marquee,
  ScrollProgressBar,
  TypeIn,
} from "@/app/components/motion";
import {
  getCreditPackOverlays,
  getFaqItems,
  getFeatures,
  getHero,
  getPricingOverlays,
  getTestimonials,
  type CreditPackOverlay,
  type PricingTierOverlay,
} from "@/lib/sanity";

export function meta() {
  return [
    { title: "AutoFlow — Hire your first team of agents" },
    {
      name: "description",
      content:
        "Write a mission. AutoFlow drafts a hiring plan, an org, a budget, and the first week of work. Approve what matters. Watch the rest run.",
    },
    { property: "og:title", content: "AutoFlow — Hire your first team of agents" },
    {
      property: "og:description",
      content:
        "Workforce automation, by the role — not by the node. Bring your own keys, ship on day one.",
    },
    { property: "og:type", content: "website" },
    { property: "og:url", content: "https://helloautoflow.com/" },
    { property: "og:site_name", content: "AutoFlow" },
    { property: "og:image", content: "https://helloautoflow.com/og.svg" },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    {
      property: "og:image:alt",
      content: "AutoFlow — hire a team of agents that actually ship",
    },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: "AutoFlow — Hire your first team of agents" },
    {
      name: "twitter:description",
      content:
        "Workforce automation, by the role — not by the node. Bring your own keys, ship on day one.",
    },
    { name: "twitter:image", content: "https://helloautoflow.com/og.svg" },
  ];
}

// The homepage SSRs at runtime (Sanity-driven) rather than prerendering, so
// Studio edits go live. Edge-cache briefly to stay fast; edits propagate within
// ~a minute (or instantly where the edge cache is bypassed).
export function headers() {
  return {
    "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
  };
}

const GITHUB_URL = "https://github.com/bdunk881/paperclipai";
// Set to the public Product Hunt listing to surface the PH badge in the hero.
// Empty by default so we never ship a broken link before the URL is confirmed.
const PRODUCT_HUNT_URL = "";

// Hardcoded factual FAQ. A Sanity `faqItem` set replaces this when present —
// these are product facts (not social proof), so a fallback is honest.
const FAQ_FALLBACK: Array<{ question: string; answer: string }> = [
  {
    question: "Do I need my own API keys?",
    answer:
      "No — AutoFlow includes free hosted models so you can run on day one. Bring your own Anthropic, OpenAI, Gemini, or Mistral key anytime for more control.",
  },
  {
    question: "How is this different from n8n or Zapier?",
    answer:
      "Those wire apps together with triggers and nodes. AutoFlow gives you a team of agents with roles, budgets, approvals, and a paper trail — a workforce, not a flowchart.",
  },
  {
    question: "Can I self-host?",
    answer:
      "Yes. AutoFlow is open source under the MIT license — run it yourself, or use our hosted cloud.",
  },
  {
    question: "What does it cost?",
    answer:
      "Start free for 14 days, no card. Paid plans begin at $19/mo, plus pay-as-you-go credit packs that never expire.",
  },
  {
    question: "Is my data isolated?",
    answer:
      "Every workspace is tenant-isolated with Postgres row-level security. Your agents' memory and data are never shared across workspaces.",
  },
  {
    question: "What if an agent tries something risky?",
    answer:
      "You set approval policies. Risky steps pause for your sign-off; everything else runs and logs to a live activity feed.",
  },
];

// Hardcoded fallback for the 3-up "how it works" features. A Sanity `feature`
// set (matched by `order`) overrides the title/description per card; the SVG art
// and numbered eyebrow stay fixed (the illustration is intentionally not editable).
const FEATURE_FALLBACK: Array<{ title: string; description: string }> = [
  {
    title: "Write a mission, get an org.",
    description:
      "Type the work that needs doing. AutoFlow drafts a PRD, picks the right roles, sets budgets, and proposes who reports to whom — in one shot.",
  },
  {
    title: "Approve what matters. Skip the rest.",
    description:
      "Agents file tickets when a step crosses your policy line — spend, scope, risk. Stamp it from email, Slack, or your phone. Everything else just runs.",
  },
  {
    title: "A paper trail your CFO will love.",
    description:
      "Every step, every dollar, every model call — recorded, attributable, exportable. Set per-agent caps so a runaway loop never becomes a runaway invoice.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Data — pulled from Projects/AutoFlow/v2/data.jsx and the inline scripts in
// the v2 Landing.html. Kept inline so the landing renders at build time with
// zero runtime data fetching (Cloudflare Pages prerenders to static HTML).

const ROSTER: Array<{
  name: string;
  role: string;
  tier: string;
  tone: AvatarTone;
  budget: number;
  indent?: boolean;
}> = [
  { name: "Maya Chen", role: "Head of Growth", tier: "Power · Opus", tone: "clay", budget: 480 },
  { name: "Devon Park", role: "Head of Product", tier: "Power · Opus", tone: "blue", budget: 400 },
  { name: "Iris Vega", role: "Operations Lead", tier: "Standard · Sonnet", tone: "plum", budget: 240 },
  { name: "Theo Brand", role: "Content Strategist", tier: "Standard · Sonnet", tone: "mustard", budget: 120, indent: true },
  { name: "Sana Reyes", role: "SDR", tier: "Lite · Haiku", tone: "sage", budget: 90, indent: true },
];

type AvatarTone = "clay" | "sage" | "mustard" | "plum" | "blue" | "ink";

const LOGO_STRIP = [
  "Slack",
  "GitHub",
  "Linear",
  "HubSpot",
  "Stripe",
  "Notion",
  "Gmail",
  "Sentry",
  "Anthropic",
  "OpenAI",
];

const MISSIONS: Array<{
  title: string;
  ownerName: string;
  ownerInitials: string;
  ownerTone: AvatarTone;
  state: "in-flight" | "blocked" | "review" | "scheduled";
  progress: number;
  due: string;
}> = [
  { title: "Launch Q3 product hunt campaign", ownerName: "Maya", ownerInitials: "MC", ownerTone: "clay", state: "in-flight", progress: 0.62, due: "in 6 days" },
  { title: "Migrate billing service to Postgres 16", ownerName: "Devon", ownerInitials: "DP", ownerTone: "blue", state: "blocked", progress: 0.31, due: "overdue 1d" },
  { title: "Reduce p99 webhook latency below 400ms", ownerName: "Owen", ownerInitials: "OP", ownerTone: "ink", state: "in-flight", progress: 0.78, due: "in 2 days" },
  { title: "Onboard top-50 enterprise leads", ownerName: "Sana", ownerInitials: "SR", ownerTone: "sage", state: "in-flight", progress: 0.44, due: "in 11 days" },
];

const INTEGRATIONS: Array<{ name: string; cat: string }> = [
  { name: "Slack", cat: "Comms" },
  { name: "GitHub", cat: "Dev" },
  { name: "Linear", cat: "Dev" },
  { name: "HubSpot", cat: "CRM" },
  { name: "Stripe", cat: "Billing" },
  { name: "Shopify", cat: "Commerce" },
  { name: "Apollo", cat: "Data" },
  { name: "Attio", cat: "CRM" },
  { name: "Intercom", cat: "Support" },
  { name: "Gmail", cat: "Comms" },
  { name: "Teams", cat: "Comms" },
  { name: "Notion", cat: "Docs" },
  { name: "PostHog", cat: "Analytics" },
  { name: "Sentry", cat: "Observ." },
  { name: "Datadog", cat: "Observ." },
  { name: "DocuSign", cat: "Legal" },
  { name: "Anthropic", cat: "Models" },
  { name: "OpenAI", cat: "Models" },
  { name: "Google", cat: "Models" },
  { name: "Bedrock", cat: "Models" },
];

// Pricing + credit packs come from GET /api/public/landing/pricing, which
// joins subscription_tiers + credit_packs (migrations 079 + 071). Source-of-
// truth lives in the DB so marketing / Brad / Stripe can edit without a deploy.
//
// Fields that aren't yet on the schema (eyebrow tagline, marketing bullets vs
// data bullets) are layered on top here for PR3. HEL-278 moves them to a Sanity
// overlay so marketing can edit copy without a code change.

interface Tier {
  id: string;
  displayName: string;
  priceUsdCents: number;
  currency: string;
  trialDays: number;
  sortOrder: number;
  isPopular: boolean;
  features: string[];
  ctaLabel: string;
  priceUnit: string;
  /**
   * Editorial eyebrow (HEL-278). When present, sourced from a Sanity
   * `pricingTierOverlay` document; falls through to the inline
   * `EYEBROW_BY_ID` map when omitted.
   */
  eyebrow?: string;
}

interface Pack {
  id: string;
  displayName: string;
  priceUsdCents: number;
  creditsGranted: number;
  bonusPercent: number;
  sortOrder: number;
  /**
   * Optional editorial overrides (HEL-285) from a Sanity
   * `creditPackOverlay` document. All undefined → renderer falls through
   * to the current default behavior (auto-featured = highest
   * bonusPercent, "Most popular" badge, "Buy {displayName}" CTA).
   */
  tagline?: string;
  isFeaturedOverride?: boolean;
  featuredLabel?: string;
  ctaLabel?: string;
}

interface PricingLoaderData {
  tiers: Tier[];
  packs: Pack[];
}

type Testimonial = {
  quote: string;
  authorName: string;
  authorTitle: string;
  order: number;
};
type FaqItem = { question: string; answer: string };

type HeroContent = {
  eyebrow: string | null;
  headline: string | null;
  subheadline: string | null;
  primaryCta: string | null;
  secondaryCta: string | null;
};

type FeatureContent = {
  title: string;
  description: string;
  icon: string | null;
  order: number;
};

interface HomeLoaderData extends PricingLoaderData {
  testimonials: Testimonial[];
  faqItems: FaqItem[];
  hero: HeroContent | null;
  features: FeatureContent[] | null;
}

// Eyebrow taglines aren't in the DB (yet — HEL-278 will move them to Sanity).
// Map by tier id; falls back to empty if a new tier ships before this map gets
// updated.
const EYEBROW_BY_ID: Record<string, string> = {
  explore: "Solo",
  flow: "Indie operators",
  automate: "Most teams",
  scale: "SMB & Enterprise",
};

// Build-time prerender of `/` (see landing/react-router.config.ts) runs this
// loader. If the API is unreachable during `react-router build` (e.g. CI
// without backend), fall back to this snapshot so the build doesn't fail —
// keeps the landing recoverable but visibly stale via the console warning.
const FALLBACK_PRICING: PricingLoaderData = {
  tiers: [
    {
      id: "explore",
      displayName: "Explore",
      priceUsdCents: 0,
      currency: "usd",
      trialDays: 0,
      sortOrder: 10,
      isPopular: false,
      features: ["3 workspaces", "Daily Sonnet credit cap", "Community support"],
      ctaLabel: "Get started",
      priceUnit: "/mo",
    },
    {
      id: "flow",
      displayName: "Flow",
      priceUsdCents: 1900,
      currency: "usd",
      trialDays: 14,
      sortOrder: 20,
      isPopular: false,
      features: [
        "Everything in Explore",
        "Unlimited workspaces",
        "5,000 daily Sonnet credits",
        "Priority email support",
      ],
      ctaLabel: "Start 14-day trial",
      priceUnit: "/mo",
    },
    {
      id: "automate",
      displayName: "Automate",
      priceUsdCents: 4900,
      currency: "usd",
      trialDays: 14,
      sortOrder: 30,
      isPopular: true,
      features: [
        "Everything in Flow",
        "20,000 daily credits",
        "Opus model access",
        "Slack support",
        "Custom approval policies",
      ],
      ctaLabel: "Start 14-day trial",
      priceUnit: "/seat/mo",
    },
    {
      id: "scale",
      displayName: "Scale",
      priceUsdCents: 9900,
      currency: "usd",
      trialDays: 0,
      sortOrder: 40,
      isPopular: false,
      features: [
        "Everything in Automate",
        "Unlimited daily credits",
        "SSO + audit logs",
        "Dedicated success manager",
        "Custom SLAs",
      ],
      ctaLabel: "Choose Scale",
      priceUnit: "/seat/mo",
    },
  ],
  packs: [
    { id: "pack_25",  displayName: "Starter Pack", priceUsdCents: 2500,  creditsGranted: 250000,  bonusPercent: 0,  sortOrder: 10 },
    { id: "pack_50",  displayName: "Plus Pack",    priceUsdCents: 5000,  creditsGranted: 525000,  bonusPercent: 5,  sortOrder: 20 },
    { id: "pack_100", displayName: "Pro Pack",     priceUsdCents: 10000, creditsGranted: 1100000, bonusPercent: 10, sortOrder: 30 },
    { id: "pack_250", displayName: "Scale Pack",   priceUsdCents: 25000, creditsGranted: 2875000, bonusPercent: 15, sortOrder: 40 },
    { id: "pack_500", displayName: "Power Pack",   priceUsdCents: 50000, creditsGranted: 6000000, bonusPercent: 20, sortOrder: 50 },
  ],
};

/**
 * Apply Sanity overlays to API tiers. Precedence: Sanity > API. The third
 * tier (the inline EYEBROW_BY_ID fallback below) only kicks in at render
 * time for `eyebrow` and is handled in the JSX, not here.
 */
function mergeOverlays(
  tiers: Tier[],
  overlays: PricingTierOverlay[] | null,
): Tier[] {
  if (!overlays || overlays.length === 0) return tiers;
  const byId = new Map(overlays.map((o) => [o.tierId, o]));
  return tiers.map((tier) => {
    const overlay = byId.get(tier.id);
    if (!overlay) return tier;
    return {
      ...tier,
      eyebrow: overlay.eyebrow ?? tier.eyebrow,
      features: overlay.bullets ?? tier.features,
      ctaLabel: overlay.ctaLabel ?? tier.ctaLabel,
      priceUnit: overlay.priceUnit ?? tier.priceUnit,
    };
  });
}

/**
 * Apply Sanity overlays to API credit packs (HEL-285). Per-pack overrides
 * land on optional `Pack` fields the renderer consults; the "Most
 * popular" override is intentionally tri-state (true / false / undefined)
 * so editors can both promote AND demote individual packs.
 */
function mergeCreditPackOverlays(
  packs: Pack[],
  overlays: CreditPackOverlay[] | null,
): Pack[] {
  if (!overlays || overlays.length === 0) return packs;
  const byId = new Map(overlays.map((o) => [o.packId, o]));
  return packs.map((pack) => {
    const overlay = byId.get(pack.id);
    if (!overlay) return pack;
    return {
      ...pack,
      tagline: overlay.tagline ?? pack.tagline,
      isFeaturedOverride: overlay.isFeatured ?? pack.isFeaturedOverride,
      featuredLabel: overlay.featuredLabel ?? pack.featuredLabel,
      ctaLabel: overlay.ctaLabel ?? pack.ctaLabel,
    };
  });
}

export async function loader(): Promise<HomeLoaderData> {
  // Pricing API + Sanity overlays in parallel. Sanity overlay failures
  // (missing creds, GROQ errors) return null inside sanityFetch — they
  // never block the prerender; the loader just falls through to the
  // API/fallback values.
  const apiPromise = (async () => {
    try {
      const res = await fetch(buildLandingApiUrl("/api/public/landing/pricing"));
      if (!res.ok) {
        throw new Error(`pricing endpoint returned ${res.status}`);
      }
      return (await res.json()) as PricingLoaderData;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[landing/loader/pricing] using fallback snapshot: ${message}`);
      return FALLBACK_PRICING;
    }
  })();

  const [apiData, tierOverlays, packOverlays, testimonials, faqItems, hero, features] =
    await Promise.all([
      apiPromise,
      getPricingOverlays(),
      getCreditPackOverlays(),
      getTestimonials(),
      getFaqItems(),
      getHero(),
      getFeatures(),
    ]);

  return {
    tiers: mergeOverlays(apiData.tiers, tierOverlays),
    packs: mergeCreditPackOverlays(apiData.packs, packOverlays),
    // Real Sanity testimonials only — no fabricated quotes when empty.
    testimonials: testimonials ?? [],
    // Sanity FAQ when authored, else the factual fallback above.
    faqItems: (faqItems && faqItems.length > 0 ? faqItems : FAQ_FALLBACK).map(
      ({ question, answer }) => ({ question, answer }),
    ),
    hero,
    // Sanity features (matched by `order`) override per-card copy; null → fallback.
    features,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Motion choreography (HEL-777)
//
// The hero card plays the product story on load: the mission types in with a
// blinking clay caret (the v2 prototype's unshipped `.lp-prompt` motif), the
// roster stamps in row by row, the monthly estimate counts up, and the
// "Drafted in 14 seconds" ribbon rubber-stamps last (CSS `.lp-stamp`, 3.3s).
// Everything else on the page reveals in-place on scroll via `InView` + the
// `v2.css` motion layer. Timings below are one deterministic timeline.

const HERO_MISSION_TITLE = "Launch the R-7 to N. America";
const HERO_TYPE_DELAY_MS = 550;
const HERO_TYPE_SPEED_MS = 34;
/** Roster rows start after the mission finishes typing (~550 + 28×34 ms). */
const HERO_ROWS_START_S = 1.6;
const HERO_ROW_STAGGER_S = 0.12;
/** Cost counts up once the last roster row has landed. */
const HERO_COST_DELAY_MS = 2300;

/**
 * Splits a trailing "→" off a CTA label so the arrow can nudge on hover
 * (`.lp-arrow`). Labels without an arrow pass through untouched.
 */
function withArrow(label: string) {
  const match = label.match(/^(.*?)\s*(→|->)$/);
  if (!match) return label;
  return (
    <>
      {match[1]}{" "}
      <span className="lp-arrow" aria-hidden="true">
        →
      </span>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small visual primitives

function AutoFlowMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--af2-ink)" />
      <path
        d="M9 11.5a4.5 4.5 0 0 1 9 0v9a4.5 4.5 0 0 1-9 0M14 11.5a4.5 4.5 0 0 1 9 0v9"
        fill="none"
        stroke="var(--af2-paper)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Avatar({
  initials,
  tone,
  size = "md",
}: {
  initials: string;
  tone: AvatarTone;
  size?: "sm" | "md";
}) {
  const dim = size === "sm" ? 26 : 32;
  return (
    <div
      className={`af2-avatar af2-tone-${tone}${size === "sm" ? " sm" : ""}`}
      style={{ width: dim, height: dim, fontSize: size === "sm" ? 10 : 11 }}
    >
      {initials}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero CTA: routes to /signup. Clicking "Hire your first agent" also pings
// the Express waitlist-signup endpoint as a top-of-funnel intent log
// (anonymous click; backend tolerates empty/missing email).

function HireAgentCta({ label = "Hire your first agent →" }: { label?: string }) {
  return (
    <Link to="/signup" className="af2-btn af2-btn-clay" style={{ padding: "14px 22px", fontSize: 14.5 }}>
      {withArrow(label)}
    </Link>
  );
}

// Pricing CTA → Stripe Checkout for paid tiers; /signup for the free tier.
// Checkout endpoint lives in the Express backend.
function PricingCta({ tier }: { tier: Tier }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseClass = tier.isPopular ? "af2-btn af2-btn-clay" : "af2-btn";
  const baseStyle: React.CSSProperties = { width: "100%", textAlign: "center" };

  // Free tier — route to signup. The signup page redirects already-authed
  // users so we don't need a logged-in-detection shortcut on this static
  // page (see HEL-269 plan comment).
  if (tier.priceUsdCents === 0) {
    return (
      <Link to="/signup?next=/" className={baseClass} style={baseStyle}>
        {tier.ctaLabel}
      </Link>
    );
  }

  async function handleCheckout() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(buildLandingApiUrl("/api/public/landing/checkout"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: tier.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Checkout is temporarily unavailable.");
      }
      const data = (await res.json()) as { url?: string };
      if (data.url) {
        window.location.assign(data.url);
        return;
      }
      // Backend returned 200 but no URL — fall back to signup.
      window.location.assign(`/signup?next=/billing&tier=${tier.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed.");
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" onClick={handleCheckout} disabled={pending} className={baseClass} style={baseStyle}>
        {pending ? "Loading…" : tier.ctaLabel}
      </button>
      {error ? (
        <p
          role="alert"
          style={{
            fontSize: 12,
            color: "var(--af2-clay)",
            marginTop: 10,
          }}
        >
          {error} <Link to="/signup">Continue with signup →</Link>
        </p>
      ) : null}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page

export default function Home() {
  const { tiers, packs, testimonials, faqItems, hero, features } =
    useLoaderData() as HomeLoaderData;

  // 3-up features: a Sanity `feature` (matched by `order`) overrides the card's
  // title/description; otherwise fall back to the hardcoded copy. The SVG art and
  // the numbered eyebrow stay fixed.
  const featAt = (order: number) =>
    features?.find((f) => f.order === order) ?? FEATURE_FALLBACK[order - 1];

  return (
    <>
      {/* NAV */}
      <LandingNav />

      {/* HERO */}
      <section className="lp-hero">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.3fr 1fr",
            gap: 60,
            alignItems: "center",
          }}
        >
          <div>
            <span className="af2-eyebrow lp-rise">
              {hero?.eyebrow ?? "Workforce automation, by the role · not by the node."}
            </span>
            {PRODUCT_HUNT_URL ? (
              <a
                href={PRODUCT_HUNT_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="lp-rise"
                style={{
                  display: "inline-block",
                  marginTop: 12,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--af2-clay)",
                  animationDelay: ".05s",
                }}
              >
                ▲ Live on Product Hunt
              </a>
            ) : null}
            <h1 className="lp-rise" style={{ marginTop: 18, animationDelay: ".08s" }}>
              {hero?.headline ?? (
                <>
                  Hire a team
                  <br />
                  of agents that
                  <br />
                  <em>
                    <span className="lp-underline-load">actually ship.</span>
                  </em>
                </>
              )}
            </h1>
            <p className="lp-hero-sub lp-rise" style={{ animationDelay: ".18s" }}>
              {hero?.subheadline ??
                "Write a mission. AutoFlow drafts a hiring plan, an org, a budget, and the first week of work. Approve what matters. Watch the rest run."}
            </p>
            <div className="lp-hero-cta lp-rise" style={{ animationDelay: ".28s" }}>
              <HireAgentCta label={hero?.primaryCta ?? undefined} />
              <a href="#product" className="af2-btn" style={{ padding: "14px 22px", fontSize: 14.5 }}>
                {hero?.secondaryCta ?? "See how it works"}
              </a>
            </div>
            <div className="lp-hero-meta lp-rise" style={{ animationDelay: ".38s" }}>
              <span>
                <strong>14-day free</strong> · no card
              </span>
              <span style={{ color: "var(--af2-line-2)" }}>·</span>
              <span>
                Bring <strong>your own keys</strong>
              </span>
              <span style={{ color: "var(--af2-line-2)" }}>·</span>
              <span>
                <strong>SOC 2</strong> in progress
              </span>
              <span style={{ color: "var(--af2-line-2)" }}>·</span>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener">
                <strong>Open source</strong> · MIT
              </a>
            </div>
          </div>

          {/* Hero illustration: a "team roster" card. On load it plays the
              product story: mission types in → roster stamps in → estimate
              counts up → ribbon stamps → the card settles into a slow float. */}
          <div className="lp-hero-card-wrap" style={{ position: "relative" }}>
            <div
              className="af2-card"
              style={{
                padding: 0,
                background: "var(--af2-card)",
                boxShadow: "var(--af2-shadow-lg)",
                transform: "rotate(1.2deg)",
              }}
            >
              <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--af2-line)" }}>
                <span className="af2-eyebrow">Acme Robotics · hiring plan v3</span>
                <div
                  style={{
                    fontFamily: "var(--af2-serif)",
                    fontSize: 24,
                    letterSpacing: "-0.015em",
                    marginTop: 4,
                    // Reserve one full line so the card doesn't shift while
                    // the mission title types in (inherited line-height 1.5).
                    minHeight: "1.5em",
                  }}
                >
                  <TypeIn
                    text={HERO_MISSION_TITLE}
                    speed={HERO_TYPE_SPEED_MS}
                    delay={HERO_TYPE_DELAY_MS}
                  />
                </div>
              </div>
              <div style={{ padding: "8px 0 12px" }}>
                {ROSTER.map((r, i) => (
                  <div
                    key={r.name}
                    className={`lp-roster-row${r.indent ? " indent" : ""} lp-rise`}
                    style={{
                      animationDelay: `${HERO_ROWS_START_S + i * HERO_ROW_STAGGER_S}s`,
                    }}
                  >
                    <Avatar
                      initials={r.name
                        .split(" ")
                        .map((s) => s[0])
                        .join("")}
                      tone={r.tone}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="lp-roster-name">{r.name}</div>
                      <div className="lp-roster-meta">
                        {r.role} · {r.tier}
                      </div>
                    </div>
                    <span className="lp-roster-budget">${r.budget}</span>
                  </div>
                ))}
              </div>
              <div
                className="lp-rise"
                style={{
                  padding: "14px 20px",
                  background: "var(--af2-paper-2)",
                  borderTop: "1px solid var(--af2-line)",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  animationDelay: "2.1s",
                }}
              >
                <span style={{ fontSize: 12 }}>3 leads · 5 reports</span>
                <span style={{ fontFamily: "var(--af2-mono)", fontSize: 12, color: "var(--af2-ink-3)" }}>
                  est. $
                  <CountUp value={1580} trigger="mount" delay={HERO_COST_DELAY_MS} />
                  /mo
                </span>
                <span style={{ flex: 1 }} />
                <Link to="/signup" className="af2-btn af2-btn-sm af2-btn-clay">
                  Confirm &amp; onboard
                </Link>
              </div>
            </div>
            {/* Ribbon — rubber-stamps in last (CSS .lp-stamp). The inline
                rotate stays so reduced-motion (animation: none) keeps it. */}
            <div
              className="lp-stamp"
              style={{
                position: "absolute",
                top: -14,
                left: -22,
                background: "var(--af2-clay)",
                color: "#fff",
                padding: "6px 12px",
                borderRadius: 4,
                font: "500 11px var(--af2-sans)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                transform: "rotate(-3deg)",
                boxShadow: "0 6px 14px rgba(194,80,43,0.3)",
              }}
            >
              Drafted in 14 seconds
            </div>
          </div>
        </div>
      </section>

      {/* LOGO STRIP — a slow marquee; pauses on hover, static under
          reduced motion / no-JS-equivalent fallback handled in CSS. */}
      <section className="lp-logos">
        <div className="lp-logos-inner">
          <span className="lp-logos-label">Connects to</span>
          <Marquee>
            {LOGO_STRIP.map((n) => (
              <span
                key={n}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  color: "var(--af2-ink-2)",
                  opacity: 0.85,
                }}
              >
                <CompanyLogo name={n} integrationId={n.toLowerCase()} size={20} />
                <span>{n}</span>
              </span>
            ))}
          </Marquee>
        </div>
      </section>

      {/* PITCH — the three lines land in sequence; the highlighter sweeps
          under "people" once its line settles. */}
      <section className="lp-pitch">
        <InView as="p">
          <span className="lp-pitch-line lp-reveal">n8n gave you nodes.</span>
          <span className="lp-pitch-line lp-reveal" style={{ transitionDelay: ".12s" }}>
            Zapier gave you triggers.
          </span>
          <span className="lp-pitch-line lp-reveal" style={{ transitionDelay: ".24s" }}>
            <span className="lp-dim">AutoFlow gives you</span>{" "}
            <span className="lp-headline-underline" style={{ color: "var(--af2-ink)" }}>
              people
            </span>{" "}
            <span className="lp-dim">
              — a team you can brief, budget, and trust with a paper trail.
            </span>
          </span>
        </InView>
      </section>

      {/* 3-UP FEATURES — cards rise in; each card's SVG art plays once the
          grid enters view (lines write in, team pops in, ✓ stamps, bars grow). */}
      <InView as="section" className="lp-features" id="product">
        <span className="af2-eyebrow lp-reveal">How it works</span>
        <h2
          className="lp-reveal"
          style={{
            font: "400 44px/1.05 var(--af2-serif)",
            letterSpacing: "-0.02em",
            margin: "8px 0 0",
            maxWidth: 760,
            transitionDelay: ".06s",
          }}
        >
          Three things, one workflow: brief a mission, let your team plan, ship with a stamp.
        </h2>

        <InView as="div" className="lp-feature-grid">
          {/* 1 */}
          <div className="lp-feature lp-reveal">
            <div className="lp-feature-art">
              <svg width="160" height="100" viewBox="0 0 160 100" aria-hidden="true">
                <rect x="6" y="14" width="80" height="72" rx="6" fill="var(--af2-paper-2)" stroke="var(--af2-line)" />
                <line className="lp-art-line" pathLength={1} style={{ transitionDelay: ".15s" }} x1="14" y1="28" x2="74" y2="28" stroke="var(--af2-ink-3)" strokeWidth="1.4" />
                <line className="lp-art-line" pathLength={1} style={{ transitionDelay: ".27s" }} x1="14" y1="38" x2="62" y2="38" stroke="var(--af2-ink-4)" strokeWidth="1.2" />
                <line className="lp-art-line" pathLength={1} style={{ transitionDelay: ".39s" }} x1="14" y1="48" x2="70" y2="48" stroke="var(--af2-ink-4)" strokeWidth="1.2" />
                <line className="lp-art-line" pathLength={1} style={{ transitionDelay: ".51s" }} x1="14" y1="58" x2="46" y2="58" stroke="var(--af2-ink-4)" strokeWidth="1.2" />
                {/* The mission→team connector quietly marches forever. */}
                <path
                  className="lp-march"
                  d="M86 50 Q100 50 110 38"
                  fill="none"
                  stroke="var(--af2-clay)"
                  strokeWidth="1.6"
                  strokeDasharray="3 3"
                />
                <circle className="lp-art-pop" style={{ transitionDelay: ".55s" }} cx="116" cy="35" r="14" fill="var(--af2-clay)" />
                <circle className="lp-art-pop" style={{ transitionDelay: ".65s" }} cx="138" cy="55" r="11" fill="var(--af2-sage)" />
                <circle className="lp-art-pop" style={{ transitionDelay: ".75s" }} cx="118" cy="75" r="9" fill="var(--af2-mustard)" />
                <circle className="lp-art-pop" style={{ transitionDelay: ".85s" }} cx="143" cy="32" r="6" fill="var(--af2-plum)" />
              </svg>
            </div>
            <span className="af2-eyebrow">01 · Mission</span>
            <h3>{featAt(1).title}</h3>
            <p>{featAt(1).description}</p>
          </div>

          {/* 2 */}
          <div className="lp-feature lp-reveal" style={{ transitionDelay: ".08s" }}>
            <div className="lp-feature-art">
              <svg width="200" height="100" viewBox="0 0 200 100" aria-hidden="true">
                <rect x="10" y="22" width="180" height="56" rx="8" fill="var(--af2-paper-2)" stroke="var(--af2-line)" />
                <g className="lp-art-pop" style={{ transitionDelay: ".3s" }}>
                  <circle cx="34" cy="50" r="14" fill="var(--af2-clay)" />
                  <text
                    x="34"
                    y="54"
                    textAnchor="middle"
                    fill="white"
                    fontSize="11"
                    fontWeight="600"
                    fontFamily="Geist,sans-serif"
                  >
                    MC
                  </text>
                </g>
                <line className="lp-art-line" pathLength={1} style={{ transitionDelay: ".42s" }} x1="56" y1="44" x2="140" y2="44" stroke="var(--af2-ink-3)" strokeWidth="1.4" />
                <line className="lp-art-line" pathLength={1} style={{ transitionDelay: ".54s" }} x1="56" y1="54" x2="120" y2="54" stroke="var(--af2-ink-4)" strokeWidth="1.2" />
                {/* Approval stamps in last — the point of the card. */}
                <g className="lp-art-stamp" style={{ transitionDelay: ".75s" }}>
                  <rect x="148" y="36" width="38" height="28" rx="4" fill="var(--af2-ink)" />
                  <text
                    x="167"
                    y="55"
                    textAnchor="middle"
                    fill="var(--af2-paper)"
                    fontSize="11"
                    fontWeight="600"
                    fontFamily="Geist,sans-serif"
                  >
                    ✓
                  </text>
                </g>
              </svg>
            </div>
            <span className="af2-eyebrow">02 · Tickets</span>
            <h3>{featAt(2).title}</h3>
            <p>{featAt(2).description}</p>
          </div>

          {/* 3 */}
          <div className="lp-feature lp-reveal" style={{ transitionDelay: ".16s" }}>
            <div className="lp-feature-art">
              <svg width="220" height="100" viewBox="0 0 220 100" aria-hidden="true">
                <rect x="6" y="20" width="208" height="60" rx="6" fill="var(--af2-paper-2)" stroke="var(--af2-line)" />
                <line className="lp-art-line" pathLength={1} style={{ transitionDelay: ".2s" }} x1="14" y1="34" x2="206" y2="34" stroke="var(--af2-line-2)" />
                <rect className="lp-art-grow" style={{ transitionDelay: ".35s" }} x="14" y="42" width="40" height="22" rx="3" fill="var(--af2-sage)" opacity="0.85" />
                <rect className="lp-art-grow" style={{ transitionDelay: ".47s" }} x="58" y="42" width="64" height="22" rx="3" fill="var(--af2-clay)" opacity="0.85" />
                <rect className="lp-art-grow" style={{ transitionDelay: ".59s" }} x="126" y="42" width="22" height="22" rx="3" fill="var(--af2-mustard)" opacity="0.85" />
                <rect className="lp-art-grow" style={{ transitionDelay: ".71s" }} x="152" y="42" width="50" height="22" rx="3" fill="var(--af2-plum)" opacity="0.85" />
                <line className="lp-art-line" pathLength={1} style={{ transitionDelay: ".2s" }} x1="14" y1="68" x2="206" y2="68" stroke="var(--af2-line-2)" />
              </svg>
            </div>
            <span className="af2-eyebrow">03 · Receipts</span>
            <h3>{featAt(3).title}</h3>
            <p>{featAt(3).description}</p>
          </div>
        </InView>
      </InView>

      {/* BIG MOCK — the workplace mock runs when it enters view: stats count
          up, mission bars fill, the live pills keep pulsing. */}
      <InView as="section" className="lp-mock-section" id="workforce">
        <span className="af2-eyebrow lp-reveal">The workplace, not the workflow</span>
        <h2
          className="lp-reveal"
          style={{
            font: "400 44px/1.05 var(--af2-serif)",
            letterSpacing: "-0.02em",
            margin: "8px 0 36px",
            maxWidth: 760,
            transitionDelay: ".06s",
          }}
        >
          Workspaces for each company. Pods for each function. Receipts for each move.
        </h2>

        <div className="lp-mock lp-reveal" style={{ transitionDelay: ".14s" }}>
          <div className="lp-mock-inner">
            {/* Sidebar mock */}
            <div className="lp-mock-side">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 6px",
                  background: "var(--af2-card)",
                  border: "1px solid var(--af2-line)",
                  borderRadius: 6,
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 5,
                    background: "linear-gradient(140deg, var(--af2-clay), #8e3a1f)",
                    color: "white",
                    display: "grid",
                    placeItems: "center",
                    font: "600 11px var(--af2-sans)",
                  }}
                >
                  AR
                </div>
                <div style={{ lineHeight: 1.1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>Acme Robotics</div>
                  <div style={{ fontSize: 10, color: "var(--af2-ink-3)" }}>Studio · 12 seats</div>
                </div>
              </div>

              <MockNavSection title="Run" />
              <MockNavLink label="Home" active />
              <MockNavLink label="Missions" right="6" />
              <MockNavLink label="Approvals" badge="5" />
              <MockNavLink label="Activity" />

              <MockNavSection title="Workforce" />
              <MockNavLink label="Team" />
              <MockNavLink label="Hire" />
              <MockNavLink label="Budget" />

              <MockNavSection title="Build" />
              <MockNavLink label="Studio" />
              <MockNavLink label="Library" />
            </div>

            {/* Body mock */}
            <div className="lp-mock-body">
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 24,
                  paddingBottom: 16,
                  borderBottom: "1px solid var(--af2-line)",
                }}
              >
                <div>
                  <span className="af2-eyebrow">Tuesday · May 4</span>
                  <div
                    style={{
                      font: "400 32px/1.05 var(--af2-serif)",
                      letterSpacing: "-0.02em",
                      marginTop: 4,
                    }}
                  >
                    Good afternoon, Jordan.
                  </div>
                </div>
                <span style={{ flex: 1 }} />
                <button className="af2-btn af2-btn-clay af2-btn-sm" type="button">
                  ＋ New mission
                </button>
              </div>

              {/* Stats strip — counts up in view (tabular figures, no shift). */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4,1fr)",
                  border: "1px solid var(--af2-line)",
                  borderRadius: 10,
                  background: "var(--af2-card)",
                  marginTop: 16,
                  overflow: "hidden",
                }}
              >
                {(
                  [
                    {
                      label: "Missions",
                      value: 6,
                      format: (v: number) => String(Math.round(v)),
                    },
                    {
                      label: "Hours saved · 7d",
                      value: 142,
                      format: (v: number) => String(Math.round(v)),
                    },
                    {
                      label: "Spend · month",
                      value: 1207,
                      format: (v: number) => `$${Math.round(v).toLocaleString("en-US")}`,
                    },
                    {
                      label: "Approval p50",
                      value: 192, // seconds → "3m 12s"
                      format: (v: number) => {
                        const total = Math.round(v);
                        return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
                      },
                    },
                  ] as const
                ).map((stat, i, arr) => (
                  <div
                    key={stat.label}
                    style={{
                      padding: "14px 16px",
                      borderRight: i < arr.length - 1 ? "1px solid var(--af2-line)" : "none",
                    }}
                  >
                    <div className="af2-eyebrow">{stat.label}</div>
                    <div style={{ font: "400 28px/1 var(--af2-serif)", marginTop: 4 }}>
                      <CountUp
                        value={stat.value}
                        format={stat.format}
                        duration={900}
                        delay={150 + i * 120}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Missions list — progress bars fill (scaleX) once in view. */}
              <InView
                as="div"
                className="lp-missions"
                style={{
                  marginTop: 18,
                  background: "var(--af2-card)",
                  border: "1px solid var(--af2-line)",
                  borderRadius: 10,
                  overflow: "hidden",
                }}
              >
                {MISSIONS.map((m, i) => {
                  const pillCls =
                    m.state === "blocked"
                      ? "af2-pill-clay"
                      : m.state === "review"
                        ? "af2-pill-pending"
                        : "af2-pill-live";
                  const overdue = m.due.includes("overdue");
                  return (
                    <div
                      key={m.title}
                      className="lp-mission-row"
                      style={{
                        borderBottom: i < MISSIONS.length - 1 ? "1px solid var(--af2-line)" : "none",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 500 }}>{m.title}</div>
                        <div className="lp-mission-bar">
                          <div
                            style={{
                              width: `${m.progress * 100}%`,
                              background:
                                m.state === "blocked" ? "var(--af2-clay)" : "var(--af2-sage)",
                              transitionDelay: `${0.25 + i * 0.15}s`,
                            }}
                          />
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Avatar size="sm" initials={m.ownerInitials} tone={m.ownerTone} />
                        <span style={{ fontSize: 12.5 }}>{m.ownerName}</span>
                      </div>
                      <span className={`af2-pill ${pillCls}`}>
                        <span className="af2-dot" />
                        {m.state}
                      </span>
                      <span
                        style={{
                          fontFamily: "var(--af2-mono)",
                          fontSize: 11.5,
                          color: overdue ? "var(--af2-clay)" : "var(--af2-ink-3)",
                        }}
                      >
                        {m.due}
                      </span>
                    </div>
                  );
                })}
              </InView>
            </div>
          </div>
        </div>
      </InView>

      {/* INTEGRATIONS — the wall of tiles cascades in a quick wave. */}
      <InView as="section" className="lp-features" id="integrations">
        <span className="af2-eyebrow lp-reveal">Connect everything · BYOK everywhere</span>
        <h2
          className="lp-reveal"
          style={{
            font: "400 44px/1.05 var(--af2-serif)",
            letterSpacing: "-0.02em",
            margin: "8px 0 0",
            maxWidth: 760,
            transitionDelay: ".06s",
          }}
        >
          16 integrations live. Five model providers. One MCP-friendly contract for the rest.
        </h2>

        <InView
          as="div"
          id="lp-integrations"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(8,1fr)",
            gap: 12,
            marginTop: 32,
          }}
        >
          {INTEGRATIONS.map((it, i) => (
            <div
              key={it.name}
              className="af2-card lp-reveal"
              style={{ padding: 14, textAlign: "center", transitionDelay: `${i * 0.03}s` }}
            >
              <div style={{ height: 36, display: "grid", placeItems: "center" }}>
                <CompanyLogo name={it.name} integrationId={it.name.toLowerCase()} size={28} />
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, marginTop: 8 }}>{it.name}</div>
              <div style={{ fontSize: 10.5, color: "var(--af2-ink-3)", marginTop: 1 }}>
                {it.cat}
              </div>
            </div>
          ))}
        </InView>
      </InView>

      {/* PRICING — cards rise in; bullets land with their card (reading
          content stays instant per the research). */}
      <InView as="section" className="lp-pricing" id="pricing">
        <span className="af2-eyebrow lp-reveal">Pricing</span>
        <h2
          className="lp-reveal"
          style={{
            font: "400 44px/1.05 var(--af2-serif)",
            letterSpacing: "-0.02em",
            margin: "8px 0 0",
            maxWidth: 760,
            transitionDelay: ".06s",
          }}
        >
          Pay for outcomes, not seats. Bring your own model spend.
        </h2>
        <p
          className="lp-reveal"
          style={{
            fontSize: 15,
            color: "var(--af2-ink-2)",
            marginTop: 14,
            maxWidth: 680,
            transitionDelay: ".12s",
          }}
        >
          Plans cover the platform — workspaces, agents, governance, audit. Model usage is billed
          to your provider keys at cost.
        </p>

        <InView as="div" className="lp-tiers">
          {tiers.map((t, i) => (
            <div
              key={t.id}
              className={`lp-tier${t.isPopular ? " featured" : ""} lp-reveal`}
              style={{ transitionDelay: `${i * 0.07}s` }}
            >
              <span
                className="af2-eyebrow"
                style={{ color: t.isPopular ? "var(--af2-clay-2)" : undefined }}
              >
                {t.eyebrow ?? EYEBROW_BY_ID[t.id] ?? ""}
              </span>
              <h3>{t.displayName}</h3>
              <div className="lp-price">
                {t.priceUsdCents === 0 ? "$0" : `$${Math.round(t.priceUsdCents / 100)}`}
                <small>{t.priceUnit}</small>
              </div>
              <ul>
                {t.features.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <PricingCta tier={t} />
            </div>
          ))}
        </InView>
      </InView>

      {/* PAY-AS-YOU-GO CREDIT PACKS */}
      <InView as="section" className="lp-credit-packs" id="credit-packs">
        <span className="af2-eyebrow lp-reveal">Pay-as-you-go</span>
        <h2
          className="lp-reveal"
          style={{
            font: "400 44px/1.05 var(--af2-serif)",
            letterSpacing: "-0.02em",
            margin: "8px 0 0",
            maxWidth: 820,
            transitionDelay: ".06s",
          }}
        >
          Skip the vendor and api key setup. Buy credits and use our hosted models. Pay only when you run. Never expires.
        </h2>
        <p
          className="lp-reveal"
          style={{
            fontSize: 15,
            color: "var(--af2-ink-2)",
            marginTop: 14,
            maxWidth: 680,
            transitionDelay: ".12s",
          }}
        >
          Top up with credit packs and route through any of our hosted models — Sonnet, Opus, Haiku — at the tier you choose. Credits never auto-renew, and you only ever pay for what you actually use. Bigger packs include bonus credits to stretch your budget further.
        </p>

        <InView as="div" className="lp-packs">
          {(() => {
            // Auto "Most popular" target = pack with the highest bonusPercent.
            // Overlay can override this per-pack (tri-state: true / false /
            // undefined) — see mergeCreditPackOverlays.
            const maxBonus = Math.max(...packs.map((x) => x.bonusPercent), 0);
            const autoFeaturedId = packs.find(
              (x) => x.bonusPercent === maxBonus && maxBonus > 0,
            )?.id;
            return packs.map((p, i) => {
              const featured =
                p.isFeaturedOverride ?? p.id === autoFeaturedId;
              const ctaLabel = p.ctaLabel ?? `Buy ${p.displayName}`;
              const featuredLabel = p.featuredLabel ?? "Most popular";
              return (
                <div
                  key={p.id}
                  className={`lp-pack${featured ? " featured" : ""} lp-reveal`}
                  style={{ transitionDelay: `${i * 0.06}s` }}
                >
                  {featured ? <span className="lp-pack-popular">{featuredLabel}</span> : null}
                  <h3>{p.displayName}</h3>
                  {p.tagline ? (
                    <div
                      style={{
                        fontSize: 12.5,
                        color: "var(--af2-ink-3)",
                        marginTop: -2,
                        marginBottom: 6,
                      }}
                    >
                      {p.tagline}
                    </div>
                  ) : null}
                  <div className="lp-price">
                    ${Math.round(p.priceUsdCents / 100)}
                    <small>one-time</small>
                  </div>
                  <div className="lp-pack-credits">
                    {p.creditsGranted.toLocaleString("en-US")} credits
                  </div>
                  {p.bonusPercent > 0 ? (
                    <span className="lp-pack-bonus">+{p.bonusPercent}% bonus</span>
                  ) : null}
                  <Link
                    to={`/signup?next=/billing&pack=${p.id}`}
                    className={featured ? "af2-btn af2-btn-clay" : "af2-btn"}
                    style={{ width: "100%", textAlign: "center", marginTop: 20 }}
                  >
                    {ctaLabel}
                  </Link>
                </div>
              );
            });
          })()}
        </InView>

        <p
          style={{
            fontSize: 13.5,
            color: "var(--af2-ink-3)",
            marginTop: 28,
            maxWidth: 680,
          }}
        >
          Already on a subscription? Credit packs stack on top of your plan&apos;s included credits.
        </p>
      </InView>

      {/* TESTIMONIALS — Sanity-driven; the whole section is omitted when there
          are none (no fabricated quotes on a pre-customer landing). */}
      {testimonials.length > 0 ? (
        <section
          className="lp-section"
          style={{ padding: "60px 32px" }}
          aria-label="What early teams say"
        >
          <span className="af2-eyebrow">From early teams</span>
          <InView
            as="div"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: 20,
              marginTop: 22,
            }}
          >
            {testimonials.map((t, i) => (
              <figure
                key={i}
                className="af2-card lp-reveal"
                style={{
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                  transitionDelay: `${i * 0.08}s`,
                }}
              >
                <blockquote
                  style={{ margin: 0, fontSize: 15.5, lineHeight: 1.5, color: "var(--af2-ink)" }}
                >
                  &ldquo;{t.quote}&rdquo;
                </blockquote>
                <figcaption
                  style={{ display: "flex", alignItems: "center", gap: 10, marginTop: "auto" }}
                >
                  <Avatar
                    initials={t.authorName
                      .split(" ")
                      .map((s) => s[0])
                      .join("")
                      .slice(0, 2)}
                    tone={(["clay", "sage", "mustard", "plum", "blue"] as AvatarTone[])[i % 5]}
                    size="sm"
                  />
                  <span style={{ fontSize: 12.5 }}>
                    <strong>{t.authorName}</strong>
                    <span style={{ color: "var(--af2-ink-3)" }}> · {t.authorTitle}</span>
                  </span>
                </figcaption>
              </figure>
            ))}
          </InView>
        </section>
      ) : null}

      {/* FAQ — Sanity-driven with a factual hardcoded fallback. Reading
          content: the accordion is quick (280ms) and the list never
          scroll-reveals — only the heading does. */}
      <InView
        as="section"
        className="lp-section"
        style={{ padding: "60px 32px" }}
        id="faq"
        aria-label="Frequently asked questions"
      >
        <span className="af2-eyebrow lp-reveal">Questions</span>
        <h2
          className="lp-reveal"
          style={{
            font: "400 36px/1.1 var(--af2-serif)",
            letterSpacing: "-0.02em",
            margin: "8px 0 26px",
            maxWidth: 700,
            transitionDelay: ".06s",
          }}
        >
          The short version.
        </h2>
        <div style={{ maxWidth: 760 }}>
          {faqItems.map((f, i) => (
            <details
              key={i}
              open={i === 0}
              className="lp-faq"
              style={{ borderTop: "1px solid var(--af2-line)", padding: "16px 0" }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  fontWeight: 500,
                  fontSize: 15.5,
                  color: "var(--af2-ink)",
                }}
              >
                {f.question}
              </summary>
              <p
                style={{
                  margin: "10px 0 0",
                  fontSize: 14.5,
                  lineHeight: 1.55,
                  color: "var(--af2-ink-2)",
                  maxWidth: 680,
                }}
              >
                {f.answer}
              </p>
            </details>
          ))}
        </div>
      </InView>

      {/* CTA — the closing headline rises and "today." underlines itself. */}
      <InView as="section" className="lp-cta">
        <h2 className="lp-reveal">
          Hire your
          <br />
          first agent{" "}
          <em>
            <span className="lp-underline-view">today.</span>
          </em>
        </h2>
        <p
          className="lp-reveal"
          style={{
            fontSize: 18,
            color: "var(--af2-ink-2)",
            maxWidth: 600,
            margin: "24px auto 0",
            transitionDelay: ".08s",
          }}
        >
          14 days free, no card. Cancel by deleting the workspace.
        </p>
        <div
          className="lp-reveal"
          style={{
            marginTop: 30,
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
            transitionDelay: ".16s",
          }}
        >
          <Link to="/signup" className="af2-btn af2-btn-clay" style={{ padding: "14px 24px", fontSize: 14.5 }}>
            {withArrow("Start free →")}
          </Link>
          <Link to="/demo" className="af2-btn" style={{ padding: "14px 24px", fontSize: 14.5 }}>
            Watch a 90s demo
          </Link>
        </div>
      </InView>

      {/* FOOTER */}
      <footer className="lp-foot">
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <AutoFlowMark size={20} />
          <strong style={{ color: "var(--af2-ink)" }}>AutoFlow</strong> · workforce automation
        </span>
        <span style={{ flex: 1 }} />
        <Link to="/blog">Blog</Link>
        <a href="https://status.helloautoflow.com">Status</a>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener">
          GitHub
        </a>
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        <span>© {new Date().getFullYear()}</span>
      </footer>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sticky nav: gains elevation once the page scrolls, and carries the 2px clay
// reading-progress hairline (HEL-777).

function LandingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`lp-nav${scrolled ? " scrolled" : ""}`} id="top">
      <div className="lp-nav-inner">
        <Link
          to="/"
          style={{
            textDecoration: "none",
            color: "inherit",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <AutoFlowMark />
          <span
            style={{
              fontFamily: "var(--af2-serif)",
              fontSize: 19,
              fontWeight: 500,
              letterSpacing: "-0.02em",
            }}
          >
            AutoFlow
          </span>
        </Link>
        <a href="#product">Product</a>
        <a href="#workforce">Workforce</a>
        <a href="#integrations">Integrations</a>
        <a href="#pricing">Pricing</a>
        <Link to="/blog">Blog</Link>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener">
          GitHub
        </a>
        <span style={{ flex: 1 }} />
        <Link to="/signup" style={{ fontSize: 13.5 }}>
          Sign in
        </Link>
        <Link to="/signup" className="af2-btn af2-btn-primary af2-btn-sm">
          Start free
        </Link>
      </div>
      <ScrollProgressBar />
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny mock-sidebar primitives (kept inline so this file is the single
// source for the dashboard mock — no extra component file just for these).

function MockNavSection({ title }: { title: string }) {
  return (
    <div
      style={{
        font: "500 10px/1 var(--af2-sans)",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--af2-ink-4)",
        padding: "14px 10px 4px",
      }}
    >
      {title}
    </div>
  );
}

function MockNavLink({
  label,
  active,
  right,
  badge,
}: {
  label: string;
  active?: boolean;
  right?: string;
  badge?: string;
}) {
  const baseStyle: React.CSSProperties = {
    padding: "6px 10px",
    fontSize: 13,
    color: active ? "var(--af2-paper)" : "var(--af2-ink-2)",
    borderRadius: 5,
    background: active ? "var(--af2-ink)" : undefined,
  };
  return (
    <div style={baseStyle}>
      {label}
      {badge ? (
        <span
          style={{
            float: "right",
            fontSize: 11,
            background: "var(--af2-clay)",
            color: "#fff",
            padding: "1px 5px",
            borderRadius: 999,
          }}
        >
          {badge}
        </span>
      ) : right ? (
        <span style={{ float: "right", fontSize: 11, color: "var(--af2-ink-3)" }}>{right}</span>
      ) : null}
    </div>
  );
}
