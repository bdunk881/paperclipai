/**
 * AutoFlow v2 landing — HEL-33.
 *
 * Editorial port of `Projects/AutoFlow/v2/AutoFlow Landing.html`. Design
 * tokens + the `.lp-*` / `.af2-*` classes live in `./v2.css`. Real form
 * submissions still hit the FastAPI backend via `buildLandingApiUrl()`
 * (see `landing/lib/publicApi.ts`).
 */

import { Link } from "react-router";
import { useState } from "react";
import { buildLandingApiUrl } from "@/lib/publicApi";

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
  ];
}

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

const PRICING_TIERS: Array<{
  eyebrow: string;
  name: string;
  price: string;
  unit: string;
  bullets: string[];
  cta: string;
  ctaHref?: string;
  ctaPriceTier?: "starter" | "growth" | "scale";
  featured?: boolean;
}> = [
  {
    eyebrow: "Solo",
    name: "Tinker",
    price: "$0",
    unit: "/mo",
    bullets: [
      "1 workspace, 3 agents",
      "500 runs / mo",
      "Community integrations",
      "Bring your own keys",
    ],
    cta: "Start free",
    ctaHref: "/signup",
  },
  {
    eyebrow: "Most teams",
    name: "Team",
    price: "$49",
    unit: "/seat/mo",
    bullets: [
      "3 workspaces, 25 agents",
      "10k runs / mo",
      "All integrations + custom MCP",
      "Approvals, audit log, SSO",
      "Per-agent budgets",
    ],
    cta: "Try Team",
    ctaPriceTier: "growth",
    featured: true,
  },
  {
    eyebrow: "SMB & Enterprise",
    name: "Studio",
    price: "Talk",
    unit: " to us",
    bullets: [
      "Unlimited workspaces & agents",
      "SSO/SAML, SCIM, RBAC",
      "Self-hosted runners",
      "Custom MCP servers, on-prem",
      "Dedicated solutions engineer",
    ],
    cta: "Book a demo",
    ctaHref: "mailto:hello@helloautoflow.com?subject=AutoFlow Studio demo",
  },
];

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

// Inline brand logos for the strip + integrations grid. Faithful to the
// inline SVGs from `Projects/AutoFlow/v2/data.jsx::AF2_LOGOS`.
function BrandLogo({ name, size = 20 }: { name: string; size?: number }) {
  const sz = size;
  switch (name) {
    case "Slack":
      return (
        <svg viewBox="0 0 60 60" width={sz} height={sz} aria-hidden="true">
          <path fill="#36C5F0" d="M22 38a4 4 0 1 1-4-4h4zm2 0a4 4 0 1 1 8 0v10a4 4 0 1 1-8 0z" />
          <path fill="#2EB67D" d="M28 14a4 4 0 1 1 4 4h-4zm0 2a4 4 0 1 1 0 8H18a4 4 0 1 1 0-8z" />
          <path fill="#ECB22E" d="M48 22a4 4 0 1 1 4 4h-4zm-2 0a4 4 0 1 1-8 0V12a4 4 0 1 1 8 0z" />
          <path fill="#E01E5A" d="M38 46a4 4 0 1 1-4-4h4zm0-2a4 4 0 1 1 0-8h10a4 4 0 1 1 0 8z" />
        </svg>
      );
    case "GitHub":
      return (
        <svg viewBox="0 0 24 24" width={sz} height={sz} aria-hidden="true">
          <path
            fill="#1a1410"
            d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.92.58.1.79-.25.79-.55v-2c-3.2.69-3.87-1.36-3.87-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.17.91-.25 1.89-.38 2.86-.38.97 0 1.95.13 2.86.38 2.19-1.48 3.15-1.17 3.15-1.17.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.07 0 4.4-2.7 5.37-5.27 5.65.41.36.78 1.06.78 2.13v3.16c0 .31.21.66.79.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"
          />
        </svg>
      );
    case "Linear":
      return (
        <svg viewBox="0 0 100 100" width={sz} height={sz} aria-hidden="true">
          <defs>
            <linearGradient id={`lin-${name}`} x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#5E6AD2" />
              <stop offset="1" stopColor="#26C6DA" />
            </linearGradient>
          </defs>
          <path
            fill={`url(#lin-${name})`}
            d="M1.2 61.6 38.4 98.8a50 50 0 0 1-37.2-37.2zm0-13.7L52.1 98.8a50 50 0 0 0 12.6-1.6L2.8 35.4a50 50 0 0 0-1.6 12.5zm5.5-21.5 66.9 66.9a50 50 0 0 0 9.4-6.3L13 17.3a50 50 0 0 0-6.3 9.1zm12.7-15L84 76a50 50 0 1 0-64.6-64.6z"
          />
        </svg>
      );
    case "HubSpot":
      return (
        <svg viewBox="0 0 32 32" width={sz} height={sz} aria-hidden="true">
          <path
            fill="#FF7A59"
            d="M22.4 11.7V8.5a2.5 2.5 0 1 0-2 0v3.2a8.5 8.5 0 0 0-3.5 1.4l-9.5-7.4a3 3 0 1 0-1.3 1.5l9.4 7.3a8.5 8.5 0 0 0 .1 9.6l-2.8 2.8a2.7 2.7 0 1 0 1.5 1.4l2.8-2.8a8.5 8.5 0 1 0 5.3-15.8zm-1 13.3a4.6 4.6 0 1 1 0-9.2 4.6 4.6 0 0 1 0 9.2z"
          />
        </svg>
      );
    case "Stripe":
      return (
        <svg viewBox="0 0 60 25" width={32} height={14} aria-hidden="true">
          <path
            fill="#635BFF"
            d="M59.6 14.1c0-4.3-2-7.6-5.9-7.6-3.9 0-6.4 3.4-6.4 7.6 0 4.9 2.7 7.4 6.8 7.4 2 0 3.5-.5 4.6-1.1v-3.4c-1.1.6-2.4 1-4 1-1.6 0-3-.6-3.2-2.5h8c0-.2.1-.9.1-1.4zm-8.1-1.6c0-1.8 1.1-2.6 2.1-2.6 1 0 2.1.7 2.1 2.6h-4.2zm-10.4-6c-1.7 0-2.7.8-3.3 1.3l-.2-1H34v19.4l4.1-.9v-4.7c.6.4 1.5 1 3 1 3 0 5.8-2.4 5.8-7.7 0-4.8-2.8-7.4-5.8-7.4zm-1 11.3c-1 0-1.6-.4-2-.8V11.3c.4-.5 1-.9 2-.9 1.6 0 2.7 1.7 2.7 3.7 0 2-1.1 3.7-2.7 3.7zM27.7 5.5l4.1-.9V1.2l-4.1.9v3.4zm0 1.3h4.1v14.4h-4.1V6.8zm-4.4 1.2-.3-1.2h-3.5v14.4h4.1V11.6c1-1.3 2.6-1 3.1-.9V6.8c-.5-.2-2.4-.5-3.4 1.2zm-8.2-4.7-4 .8v13.2c0 2.4 1.8 4.2 4.3 4.2 1.4 0 2.4-.3 3-.5v-3.3c-.5.2-3.2 1-3.2-1.5v-5.9h3.2V6.8h-3.2l-.1-3.5zM4.2 11c0-.6.5-.9 1.4-.9 1.2 0 2.7.4 4 1.1V7.4c-1.4-.5-2.7-.7-4-.7-3.3 0-5.5 1.7-5.5 4.6 0 4.5 6.2 3.7 6.2 5.7 0 .8-.7 1-1.6 1-1.4 0-3.1-.5-4.5-1.3v3.9c1.5.6 3 .9 4.5.9 3.3 0 5.7-1.7 5.7-4.5 0-4.8-6.2-3.9-6.2-5.9z"
          />
        </svg>
      );
    case "Notion":
      return (
        <svg viewBox="0 0 32 32" width={sz} height={sz} aria-hidden="true">
          <path
            fill="#fff"
            stroke="#1a1410"
            strokeWidth="1.5"
            d="M5 6.5 19 5l8 1v20l-7 1.5L5 25.5V6.5z"
          />
          <path fill="#1a1410" d="m11 11 9 .5v11l-2 .3-7-9.5V22l-1.5.3V11z" />
        </svg>
      );
    case "Gmail":
      return (
        <svg viewBox="0 0 48 36" width={22} height={18} aria-hidden="true">
          <path fill="#4285F4" d="M3 36h7V19L0 11.5V33a3 3 0 0 0 3 3z" />
          <path fill="#34A853" d="M38 36h7a3 3 0 0 0 3-3V11.5L38 19v17z" />
          <path fill="#FBBC04" d="M38 5v14l10-7.5V6.5C48 3.6 44.7 1.9 42.4 3.7L38 5z" />
          <path fill="#EA4335" d="M10 19V5l14 10.5L38 5v14L24 29.5 10 19z" />
          <path fill="#C5221F" d="M0 6.5v5L10 19V5L5.6 3.7C3.3 1.9 0 3.6 0 6.5z" />
        </svg>
      );
    case "Sentry":
      return (
        <svg viewBox="0 0 32 32" width={sz} height={sz} aria-hidden="true">
          <path
            fill="#362D59"
            d="M16 4a2 2 0 0 1 1.7 1l8 14a2 2 0 0 1-1.7 3h-3.5a13 13 0 0 0-9-12L14 6.6a2 2 0 0 1 2-2.6zm-4.5 7.5L9 14a10 10 0 0 1 8 8h-3a7 7 0 0 0-5.3-5.4L7 19c4 .5 7.2 3.6 7.7 7.5h-7a1 1 0 0 1-.9-1.5l4.7-13.5z"
          />
        </svg>
      );
    case "Anthropic":
      return (
        <svg viewBox="0 0 64 64" width={sz} height={sz} aria-hidden="true">
          <circle cx="32" cy="32" r="30" fill="#1a1410" />
          <path fill="#D4A27F" d="M21 19h6l9 26h-6l-2-6h-9l-2 6h-6l10-26zm1 15h6l-3-9-3 9zm17-15h5v26h-5z" />
        </svg>
      );
    case "OpenAI":
      return (
        <svg viewBox="0 0 32 32" width={sz} height={sz} aria-hidden="true">
          <circle cx="16" cy="16" r="15" fill="#1a1410" />
          <path
            fill="#10A37F"
            d="M22 14a3.6 3.6 0 0 0-.3-3 3.7 3.7 0 0 0-4-1.8 3.7 3.7 0 0 0-2.8-1.2 3.7 3.7 0 0 0-3.6 2.6 3.7 3.7 0 0 0-2.5 1.8 3.7 3.7 0 0 0 .5 4.4 3.6 3.6 0 0 0 .3 3 3.7 3.7 0 0 0 4 1.8 3.7 3.7 0 0 0 2.8 1.2 3.7 3.7 0 0 0 3.6-2.6 3.7 3.7 0 0 0 2.5-1.8 3.7 3.7 0 0 0-.5-4.4zm-5.5 7.7a2.7 2.7 0 0 1-1.8-.7v-5l4.3 2.5v3a.3.3 0 0 1-.1.2 2.8 2.8 0 0 1-2.4.7zm-5.9-2.5a2.8 2.8 0 0 1 0-2.7L13 18l4.4-2.5v3l-4.3 2.4a.3.3 0 0 1-.3 0zm-1-7.7a2.8 2.8 0 0 1 1.4-1.2v5l4.4 2.5L11 19.2a.3.3 0 0 1-.3 0z"
          />
        </svg>
      );
    case "Google":
      return (
        <svg viewBox="0 0 32 32" width={sz} height={sz} aria-hidden="true">
          <path fill="#4285F4" d="M16 13v6h8a8 8 0 0 1-8 6 9 9 0 1 1 6-15.7l4.4-4.4A15 15 0 1 0 16 31a14.4 14.4 0 0 0 14-15c0-1-.1-2-.3-3H16z" />
        </svg>
      );
    case "Bedrock":
      return (
        <svg viewBox="0 0 32 32" width={sz} height={sz} aria-hidden="true">
          <path fill="#FF9900" d="M4 22l12-6 12 6-12 6zM16 6l12 6-12 6L4 12z" />
        </svg>
      );
    case "Shopify":
      return (
        <svg viewBox="0 0 109 124" width={18} height={20} aria-hidden="true">
          <path fill="#95BF47" d="M74 23c0-.4-.4-.6-.6-.6-.2 0-4 .1-4 .1s-2.6-2.6-2.9-2.9c-.3-.3-.9-.2-1.1-.1L64 20c-.1-.4-.4-1-.6-1.6-1-1.9-2.6-3-4.4-3h-.4c-.1-.2-.2-.3-.3-.4-.8-.9-1.9-1.3-3.1-1.3-2.5.1-5 1.9-7 5.1-1.5 2.3-2.6 5.1-2.9 7.3-2.9.9-4.9 1.5-5 1.5-1.4.5-1.5.5-1.7 1.9C38.5 30 35 56.4 35 56.4l28.5 5L78 57.7S74 23.4 74 23z" />
          <path fill="#5E8E3E" d="M73.4 22.4s-3.7.1-3.7.1-2.6-2.5-2.9-2.8c-.1-.1-.3-.2-.4-.2v18.4l14.5-3.6S74 23.3 74 22.7c-.1-.2-.4-.3-.6-.3z" />
          <path fill="#fff" d="m63.6 30.7-1.7 6.3s-1.9-.9-4.1-.7c-3.3.2-3.3 2.3-3.3 2.8.2 2.8 7.5 3.4 7.9 9.9.3 5.1-2.7 8.6-7.1 8.9-5.3.3-8.2-2.8-8.2-2.8L48.3 51s2.9 2.2 5.2 2c1.5-.1 2.1-1.4 2-2.2-.3-3.6-6.2-3.4-6.6-9.4-.3-5 3-10.1 10.1-10.5 2.9-.3 4.6.4 4.6.4z" />
        </svg>
      );
    case "Apollo":
      return (
        <svg viewBox="0 0 64 64" width={sz} height={sz} aria-hidden="true">
          <circle cx="32" cy="32" r="28" fill="#22118b" />
          <path fill="#fff" d="M32 14 18 46h6l3-7h10l3 7h6L32 14zm-3 19 3-7 3 7h-6z" />
        </svg>
      );
    case "Attio":
      return (
        <svg viewBox="0 0 32 32" width={sz} height={sz} aria-hidden="true">
          <circle cx="16" cy="16" r="15" fill="#1a1410" />
          <path fill="#f6f1e7" d="M16 8 9 24h3l1.5-3.5h5L20 24h3L16 8zm-1.5 9.5L16 14l1.5 3.5h-3z" />
        </svg>
      );
    case "Intercom":
      return (
        <svg viewBox="0 0 28 32" width={18} height={20} aria-hidden="true">
          <path fill="#0057FF" d="M26 0H2C.9 0 0 .9 0 2v25c0 1.1.9 2 2 2h6l3 3 3-3h12c1.1 0 2-.9 2-2V2c0-1.1-.9-2-2-2zM10 8h2v10h-2V8zm-4 1h2v8H6V9zm-4 1h2v6H2v-6zm22 9.7c-.3.3-3.5 3.3-10 3.3s-9.7-3-10-3.3c-.4-.4-.5-1-.1-1.4.4-.4 1-.5 1.4-.1.1.1 2.7 2.6 8.7 2.6 6.1 0 8.6-2.5 8.7-2.6.4-.4 1-.4 1.4 0 .4.4.4 1.1-.1 1.5zM26 16h-2v-6h2v6zm-4 1h-2V9h2v8zm-4 1h-2V8h2v10z" />
        </svg>
      );
    case "Teams":
      return (
        <svg viewBox="0 0 32 32" width={sz} height={sz} aria-hidden="true">
          <path fill="#5059C9" d="M19 11h7a2 2 0 0 1 2 2v7a4 4 0 0 1-4 4 5 5 0 0 1-5-5V11zm5-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
          <path fill="#7B83EB" d="M14 11h-9a1 1 0 0 0-1 1v10a6 6 0 0 0 12 0V12a1 1 0 0 0-1-1zm-3.5-2a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
          <path fill="#fff" d="M6 14h9v2h-3.5v8h-2v-8H6z" />
        </svg>
      );
    case "PostHog":
      return (
        <svg viewBox="0 0 40 40" width={sz} height={sz} aria-hidden="true">
          <path fill="#1D4AFF" d="M5 5h30v30H5z" />
          <path fill="#fff" d="m9 9 11 11h-7L9 16zm0 7 11 11h-7L9 23zm14 0 8 8h-8z" />
        </svg>
      );
    case "Datadog":
      return (
        <svg viewBox="0 0 32 32" width={sz} height={sz} aria-hidden="true">
          <path fill="#632CA6" d="M28 4 16 28l-3-6 6-1-3-6 6-1-3-6 9-4z" />
        </svg>
      );
    case "DocuSign":
      return (
        <svg viewBox="0 0 32 32" width={sz} height={sz} aria-hidden="true">
          <circle cx="16" cy="16" r="15" fill="#FFCC22" />
          <path fill="#1a1410" d="M11 9h7c4 0 7 3 7 7s-3 7-7 7h-7V9zm3 3v8h4c2.2 0 4-1.8 4-4s-1.8-4-4-4h-4z" />
        </svg>
      );
    default:
      return (
        <span className="af2-mark" aria-hidden="true">
          {name.charAt(0)}
        </span>
      );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero CTA: routes to /signup. Clicking "Hire your first agent" also pings
// the FastAPI waitlist-signup endpoint as a top-of-funnel intent log
// (anonymous click; backend tolerates empty/missing email).

function HireAgentCta() {
  return (
    <Link to="/signup" className="af2-btn af2-btn-clay" style={{ padding: "14px 22px", fontSize: 14.5 }}>
      Hire your first agent →
    </Link>
  );
}

// Pricing CTA → Stripe Checkout (production-wired) or a /signup fallback for
// Tinker tier. The checkout endpoint lives in the FastAPI backend.
function PricingCta({
  tier,
}: {
  tier: (typeof PRICING_TIERS)[number];
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseClass = tier.featured
    ? "af2-btn af2-btn-clay"
    : "af2-btn";
  const baseStyle: React.CSSProperties = { width: "100%", textAlign: "center" };

  // Static link tiers
  if (tier.ctaHref) {
    return (
      <Link to={tier.ctaHref} className={baseClass} style={baseStyle}>
        {tier.cta}
      </Link>
    );
  }

  async function handleCheckout() {
    if (!tier.ctaPriceTier) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(buildLandingApiUrl("/api/public/landing/checkout"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: tier.ctaPriceTier }),
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
      window.location.assign("/signup");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed.");
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" onClick={handleCheckout} disabled={pending} className={baseClass} style={baseStyle}>
        {pending ? "Loading…" : tier.cta}
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
  return (
    <>
      {/* NAV */}
      <header className="lp-nav" id="top">
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
          <span style={{ flex: 1 }} />
          <Link to="/signup" style={{ fontSize: 13.5 }}>
            Sign in
          </Link>
          <Link to="/signup" className="af2-btn af2-btn-primary af2-btn-sm">
            Start free
          </Link>
        </div>
      </header>

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
            <span className="af2-eyebrow">Workforce automation, by the role · not by the node.</span>
            <h1 style={{ marginTop: 18 }}>
              Hire a team
              <br />
              of agents that
              <br />
              <em>actually ship.</em>
            </h1>
            <p className="lp-hero-sub">
              Write a mission. AutoFlow drafts a hiring plan, an org, a budget, and the first week of
              work. Approve what matters. Watch the rest run.
            </p>
            <div className="lp-hero-cta">
              <HireAgentCta />
              <a href="#product" className="af2-btn" style={{ padding: "14px 22px", fontSize: 14.5 }}>
                See how it works
              </a>
            </div>
            <div className="lp-hero-meta">
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
            </div>
          </div>

          {/* Hero illustration: a "team roster" card */}
          <div style={{ position: "relative" }}>
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
                  }}
                >
                  Launch the R-7 to N. America
                </div>
              </div>
              <div style={{ padding: "8px 0 12px" }}>
                {ROSTER.map((r) => (
                  <div key={r.name} className={`lp-roster-row${r.indent ? " indent" : ""}`}>
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
                style={{
                  padding: "14px 20px",
                  background: "var(--af2-paper-2)",
                  borderTop: "1px solid var(--af2-line)",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span style={{ fontSize: 12 }}>3 leads · 5 reports</span>
                <span style={{ fontFamily: "var(--af2-mono)", fontSize: 12, color: "var(--af2-ink-3)" }}>
                  est. $1,580/mo
                </span>
                <span style={{ flex: 1 }} />
                <Link to="/signup" className="af2-btn af2-btn-sm af2-btn-clay">
                  Confirm &amp; onboard
                </Link>
              </div>
            </div>
            {/* Ribbon */}
            <div
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

      {/* LOGO STRIP */}
      <section className="lp-logos">
        <div className="lp-logos-inner">
          <span className="lp-logos-label">Connects to</span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 32,
              flex: 1,
              flexWrap: "wrap",
              opacity: 0.85,
            }}
          >
            {LOGO_STRIP.map((n) => (
              <span
                key={n}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  color: "var(--af2-ink-2)",
                }}
              >
                <BrandLogo name={n} />
                <span>{n}</span>
              </span>
            ))}
          </span>
        </div>
      </section>

      {/* PITCH */}
      <section className="lp-pitch">
        <p>
          n8n gave you nodes.
          <br />
          Zapier gave you triggers.
          <br />
          <span>AutoFlow gives you</span>{" "}
          <span className="lp-headline-underline" style={{ color: "var(--af2-ink)" }}>
            people
          </span>{" "}
          <span>— a team you can brief, budget, and trust with a paper trail.</span>
        </p>
      </section>

      {/* 3-UP FEATURES */}
      <section className="lp-features" id="product">
        <span className="af2-eyebrow">How it works</span>
        <h2
          style={{
            font: "400 44px/1.05 var(--af2-serif)",
            letterSpacing: "-0.02em",
            margin: "8px 0 0",
            maxWidth: 760,
          }}
        >
          Three things, one workflow: brief a mission, let your team plan, ship with a stamp.
        </h2>

        <div className="lp-feature-grid">
          {/* 1 */}
          <div className="lp-feature">
            <div className="lp-feature-art">
              <svg width="160" height="100" viewBox="0 0 160 100" aria-hidden="true">
                <rect x="6" y="14" width="80" height="72" rx="6" fill="var(--af2-paper-2)" stroke="var(--af2-line)" />
                <line x1="14" y1="28" x2="74" y2="28" stroke="var(--af2-ink-3)" strokeWidth="1.4" />
                <line x1="14" y1="38" x2="62" y2="38" stroke="var(--af2-ink-4)" strokeWidth="1.2" />
                <line x1="14" y1="48" x2="70" y2="48" stroke="var(--af2-ink-4)" strokeWidth="1.2" />
                <line x1="14" y1="58" x2="46" y2="58" stroke="var(--af2-ink-4)" strokeWidth="1.2" />
                <path
                  d="M86 50 Q100 50 110 38"
                  fill="none"
                  stroke="var(--af2-clay)"
                  strokeWidth="1.6"
                  strokeDasharray="3 3"
                />
                <circle cx="116" cy="35" r="14" fill="var(--af2-clay)" />
                <circle cx="138" cy="55" r="11" fill="var(--af2-sage)" />
                <circle cx="118" cy="75" r="9" fill="var(--af2-mustard)" />
                <circle cx="143" cy="32" r="6" fill="var(--af2-plum)" />
              </svg>
            </div>
            <span className="af2-eyebrow">01 · Mission</span>
            <h3>Write a mission, get an org.</h3>
            <p>
              Type the work that needs doing. AutoFlow drafts a PRD, picks the right roles, sets
              budgets, and proposes who reports to whom — in one shot.
            </p>
          </div>

          {/* 2 */}
          <div className="lp-feature">
            <div className="lp-feature-art">
              <svg width="200" height="100" viewBox="0 0 200 100" aria-hidden="true">
                <rect x="10" y="22" width="180" height="56" rx="8" fill="var(--af2-paper-2)" stroke="var(--af2-line)" />
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
                <line x1="56" y1="44" x2="140" y2="44" stroke="var(--af2-ink-3)" strokeWidth="1.4" />
                <line x1="56" y1="54" x2="120" y2="54" stroke="var(--af2-ink-4)" strokeWidth="1.2" />
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
              </svg>
            </div>
            <span className="af2-eyebrow">02 · Tickets</span>
            <h3>Approve what matters. Skip the rest.</h3>
            <p>
              Agents file tickets when a step crosses your policy line — spend, scope, risk. Stamp
              it from email, Slack, or your phone. Everything else just runs.
            </p>
          </div>

          {/* 3 */}
          <div className="lp-feature">
            <div className="lp-feature-art">
              <svg width="220" height="100" viewBox="0 0 220 100" aria-hidden="true">
                <rect x="6" y="20" width="208" height="60" rx="6" fill="var(--af2-paper-2)" stroke="var(--af2-line)" />
                <line x1="14" y1="34" x2="206" y2="34" stroke="var(--af2-line-2)" />
                <rect x="14" y="42" width="40" height="22" rx="3" fill="var(--af2-sage)" opacity="0.85" />
                <rect x="58" y="42" width="64" height="22" rx="3" fill="var(--af2-clay)" opacity="0.85" />
                <rect x="126" y="42" width="22" height="22" rx="3" fill="var(--af2-mustard)" opacity="0.85" />
                <rect x="152" y="42" width="50" height="22" rx="3" fill="var(--af2-plum)" opacity="0.85" />
                <line x1="14" y1="68" x2="206" y2="68" stroke="var(--af2-line-2)" />
              </svg>
            </div>
            <span className="af2-eyebrow">03 · Receipts</span>
            <h3>A paper trail your CFO will love.</h3>
            <p>
              Every step, every dollar, every model call — recorded, attributable, exportable. Set
              per-agent caps so a runaway loop never becomes a runaway invoice.
            </p>
          </div>
        </div>
      </section>

      {/* BIG MOCK */}
      <section className="lp-mock-section" id="workforce">
        <span className="af2-eyebrow">The workplace, not the workflow</span>
        <h2
          style={{
            font: "400 44px/1.05 var(--af2-serif)",
            letterSpacing: "-0.02em",
            margin: "8px 0 36px",
            maxWidth: 760,
          }}
        >
          Workspaces for each company. Pods for each function. Receipts for each move.
        </h2>

        <div className="lp-mock">
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

              {/* Stats strip */}
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
                {[
                  ["Missions", "6"],
                  ["Hours saved · 7d", "142"],
                  ["Spend · month", "$1,207"],
                  ["Approval p50", "3m 12s"],
                ].map(([label, value], i, arr) => (
                  <div
                    key={label}
                    style={{
                      padding: "14px 16px",
                      borderRight: i < arr.length - 1 ? "1px solid var(--af2-line)" : "none",
                    }}
                  >
                    <div className="af2-eyebrow">{label}</div>
                    <div style={{ font: "400 28px/1 var(--af2-serif)", marginTop: 4 }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Missions list */}
              <div
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
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* INTEGRATIONS */}
      <section className="lp-features" id="integrations">
        <span className="af2-eyebrow">Connect everything · BYOK everywhere</span>
        <h2
          style={{
            font: "400 44px/1.05 var(--af2-serif)",
            letterSpacing: "-0.02em",
            margin: "8px 0 0",
            maxWidth: 760,
          }}
        >
          16 integrations live. Five model providers. One MCP-friendly contract for the rest.
        </h2>

        <div
          id="lp-integrations"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(8,1fr)",
            gap: 12,
            marginTop: 32,
          }}
        >
          {INTEGRATIONS.map((it) => (
            <div key={it.name} className="af2-card" style={{ padding: 14, textAlign: "center" }}>
              <div style={{ height: 36, display: "grid", placeItems: "center" }}>
                <BrandLogo name={it.name} />
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, marginTop: 8 }}>{it.name}</div>
              <div style={{ fontSize: 10.5, color: "var(--af2-ink-3)", marginTop: 1 }}>
                {it.cat}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section className="lp-pricing" id="pricing">
        <span className="af2-eyebrow">Pricing</span>
        <h2
          style={{
            font: "400 44px/1.05 var(--af2-serif)",
            letterSpacing: "-0.02em",
            margin: "8px 0 0",
            maxWidth: 760,
          }}
        >
          Pay for outcomes, not seats. Bring your own model spend.
        </h2>
        <p
          style={{
            fontSize: 15,
            color: "var(--af2-ink-2)",
            marginTop: 14,
            maxWidth: 680,
          }}
        >
          Plans cover the platform — workspaces, agents, governance, audit. Model usage is billed
          to your provider keys at cost.
        </p>

        <div className="lp-tiers">
          {PRICING_TIERS.map((t) => (
            <div key={t.name} className={`lp-tier${t.featured ? " featured" : ""}`}>
              <span
                className="af2-eyebrow"
                style={{ color: t.featured ? "var(--af2-clay-2)" : undefined }}
              >
                {t.eyebrow}
              </span>
              <h3>{t.name}</h3>
              <div className="lp-price">
                {t.price}
                <small>{t.unit}</small>
              </div>
              <ul>
                {t.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <PricingCta tier={t} />
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="lp-cta">
        <h2>
          Hire your
          <br />
          first agent <em>today.</em>
        </h2>
        <p
          style={{
            fontSize: 18,
            color: "var(--af2-ink-2)",
            maxWidth: 600,
            margin: "24px auto 0",
          }}
        >
          14 days free, no card. Cancel by deleting the workspace.
        </p>
        <div style={{ marginTop: 30, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Link to="/signup" className="af2-btn af2-btn-clay" style={{ padding: "14px 24px", fontSize: 14.5 }}>
            Start free →
          </Link>
          <Link to="/demo" className="af2-btn" style={{ padding: "14px 24px", fontSize: 14.5 }}>
            Watch a 90s demo
          </Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="lp-foot">
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <AutoFlowMark size={20} />
          <strong style={{ color: "var(--af2-ink)" }}>AutoFlow</strong> · workforce automation
        </span>
        <span style={{ flex: 1 }} />
        <Link to="/blog">Blog</Link>
        <a href="https://status.helloautoflow.com">Status</a>
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        <span>© {new Date().getFullYear()}</span>
      </footer>
    </>
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
