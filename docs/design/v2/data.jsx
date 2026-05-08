// Shared data + nav + topbar.

window.AF2_DATA = {
  workspaces: [
    { id: "ws-acme", name: "Acme Robotics", plan: "Studio · 12 seats", tone: "clay", initials: "AR" },
    { id: "ws-northwind", name: "Northwind Coffee", plan: "Team · 4 seats", tone: "sage", initials: "NC" },
    { id: "ws-lumen", name: "Lumen Health", plan: "Enterprise", tone: "plum", initials: "LH" },
  ],
  agents: [
    { id: "ag-1", name: "Maya Chen",    role: "Head of Growth",    tone: "clay",    status: "working", missions: 3, budget: 480, spent: 312, model: "sonnet-4-5", hires: ["ag-4","ag-5"] },
    { id: "ag-2", name: "Devon Park",   role: "CTO",               tone: "blue",    status: "working", missions: 2, budget: 800, spent: 510, model: "opus-4-5",   hires: ["ag-6","ag-7"] },
    { id: "ag-3", name: "Iris Vega",    role: "Operations Lead",   tone: "plum",    status: "idle",    missions: 1, budget: 240, spent: 88,  model: "sonnet-4-5", hires: ["ag-8"] },
    { id: "ag-4", name: "Theo Brand",   role: "Content Strategist",tone: "mustard", status: "working", missions: 2, budget: 120, spent: 64,  model: "sonnet-4-5" },
    { id: "ag-5", name: "Sana Reyes",   role: "SDR",               tone: "sage",    status: "blocked", missions: 4, budget: 90,  spent: 51,  model: "haiku-4-5"  },
    { id: "ag-6", name: "Owen Park",    role: "Backend Engineer",  tone: "ink",     status: "working", missions: 2, budget: 200, spent: 142, model: "opus-4-5"   },
    { id: "ag-7", name: "Priya Bhat",   role: "QA Engineer",       tone: "sage",    status: "idle",    missions: 1, budget: 80,  spent: 22,  model: "haiku-4-5"  },
    { id: "ag-8", name: "Lou Calder",   role: "Bookkeeper",        tone: "mustard", status: "working", missions: 1, budget: 60,  spent: 18,  model: "haiku-4-5"  },
  ],
  missions: [
    { id: "ms-101", title: "Launch Q3 product hunt campaign", owner: "ag-1", state: "in-flight", progress: 0.62, due: "in 6 days",  approvals: 1 },
    { id: "ms-102", title: "Migrate billing service to Postgres 16", owner: "ag-2", state: "blocked", progress: 0.31, due: "overdue 1d", approvals: 0 },
    { id: "ms-103", title: "Reduce p99 webhook latency below 400ms", owner: "ag-6", state: "in-flight", progress: 0.78, due: "in 2 days",  approvals: 0 },
    { id: "ms-104", title: "Onboard top-50 enterprise leads",  owner: "ag-5", state: "in-flight", progress: 0.44, due: "in 11 days", approvals: 2 },
    { id: "ms-105", title: "Publish 8 SEO articles for tier-1 keywords", owner: "ag-4", state: "review", progress: 0.92, due: "in 1 day", approvals: 1 },
    { id: "ms-106", title: "Quarter-end financial close",      owner: "ag-3", state: "scheduled", progress: 0, due: "in 22 days", approvals: 0 },
  ],
  tickets: [
    { id: "AF-2418", agent: "ag-1", title: "Approve Product Hunt launch copy", risk: "low",    cost: "$0.42", time: "2m" },
    { id: "AF-2417", agent: "ag-2", title: "Sign off on Postgres 16 migration window", risk: "high",   cost: "$1.20", time: "8m" },
    { id: "AF-2416", agent: "ag-4", title: "Approve 4 outbound articles for publishing", risk: "low", cost: "$0.18", time: "1m" },
    { id: "AF-2415", agent: "ag-5", title: "Greenlight $1.2k Apollo credit top-up", risk: "medium", cost: "$1,200", time: "3m" },
    { id: "AF-2414", agent: "ag-6", title: "Promote staging to production", risk: "high",  cost: "$0.00", time: "—" },
  ],
  integrations: [
    { name: "Slack",    cat: "Comms",    auth: "OAuth", installed: true,  desc: "Send messages, read channels, react to threads." },
    { name: "GitHub",   cat: "Dev",      auth: "App",   installed: true,  desc: "Pull requests, issues, code search, deployments." },
    { name: "Linear",   cat: "Dev",      auth: "OAuth", installed: true,  desc: "Issues, projects, cycles, sprint reports." },
    { name: "HubSpot",  cat: "CRM",      auth: "OAuth", installed: true,  desc: "Contacts, deals, lifecycle, sequences." },
    { name: "Stripe",   cat: "Billing",  auth: "API",   installed: true,  desc: "Charges, refunds, subscription events." },
    { name: "Shopify",  cat: "Commerce", auth: "OAuth", installed: false, desc: "Orders, fulfillment, customer data." },
    { name: "Apollo",   cat: "Data",     auth: "API",   installed: true,  desc: "Lead enrichment, companies, contacts." },
    { name: "Attio",    cat: "CRM",      auth: "OAuth", installed: false, desc: "Records, lists, workflows." },
    { name: "Intercom", cat: "Support",  auth: "OAuth", installed: false, desc: "Conversations, contacts, articles." },
    { name: "Gmail",    cat: "Comms",    auth: "OAuth", installed: true,  desc: "Send & read mail, labels, threads." },
    { name: "Microsoft Teams", cat: "Comms", auth: "App", installed: false, desc: "Messages, meetings, channels." },
    { name: "Notion",   cat: "Docs",     auth: "OAuth", installed: true,  desc: "Pages, databases, blocks." },
    { name: "PostHog",  cat: "Analytics",auth: "API",   installed: false, desc: "Events, funnels, feature flags." },
    { name: "Sentry",   cat: "Observ.",  auth: "API",   installed: true,  desc: "Issues, releases, alerts." },
    { name: "Datadog",  cat: "Observ.",  auth: "API",   installed: false, desc: "Metrics, logs, traces, monitors." },
    { name: "DocuSign", cat: "Legal",    auth: "OAuth", installed: false, desc: "Envelopes, signatures, templates." },
  ],
  llms: [
    { vendor: "Anthropic",  models: ["claude-opus-4-5","claude-sonnet-4-5","claude-haiku-4-5"], byok: true,  status: "primary" },
    { vendor: "OpenAI",     models: ["gpt-4o","gpt-4o-mini","gpt-4.1"],                          byok: true,  status: "secondary" },
    { vendor: "Google",     models: ["gemini-2.5-pro","gemini-2.5-flash"],                       byok: true,  status: "off" },
    { vendor: "Bedrock",    models: ["claude on bedrock","llama-3 on bedrock"],                  byok: true,  status: "off" },
    { vendor: "Azure OAI",  models: ["gpt-4o on azure"],                                          byok: true,  status: "off" },
  ],
  tiers: { lite: "claude-haiku-4-5", standard: "claude-sonnet-4-5", power: "claude-opus-4-5" },
};

// Logo helpers — inline SVGs (real brand marks).
window.AF2_LOGOS = {
  Slack: <svg viewBox="0 0 60 60" width="20" height="20"><path fill="#36C5F0" d="M22 38a4 4 0 1 1-4-4h4zm2 0a4 4 0 1 1 8 0v10a4 4 0 1 1-8 0z"/><path fill="#2EB67D" d="M28 14a4 4 0 1 1 4 4h-4zm0 2a4 4 0 1 1 0 8H18a4 4 0 1 1 0-8z"/><path fill="#ECB22E" d="M48 22a4 4 0 1 1 4 4h-4zm-2 0a4 4 0 1 1-8 0V12a4 4 0 1 1 8 0z"/><path fill="#E01E5A" d="M38 46a4 4 0 1 1-4-4h4zm0-2a4 4 0 1 1 0-8h10a4 4 0 1 1 0 8z"/></svg>,
  GitHub: <svg viewBox="0 0 24 24" width="20" height="20"><path fill="#1a1410" d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.92.58.1.79-.25.79-.55v-2c-3.2.69-3.87-1.36-3.87-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.17.91-.25 1.89-.38 2.86-.38.97 0 1.95.13 2.86.38 2.19-1.48 3.15-1.17 3.15-1.17.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.07 0 4.4-2.7 5.37-5.27 5.65.41.36.78 1.06.78 2.13v3.16c0 .31.21.66.79.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/></svg>,
  Linear: <svg viewBox="0 0 100 100" width="20" height="20"><defs><linearGradient id="lin" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#5E6AD2"/><stop offset="1" stopColor="#26C6DA"/></linearGradient></defs><path fill="url(#lin)" d="M1.2 61.6 38.4 98.8a50 50 0 0 1-37.2-37.2zm0-13.7L52.1 98.8a50 50 0 0 0 12.6-1.6L2.8 35.4a50 50 0 0 0-1.6 12.5zm5.5-21.5 66.9 66.9a50 50 0 0 0 9.4-6.3L13 17.3a50 50 0 0 0-6.3 9.1zm12.7-15L84 76a50 50 0 1 0-64.6-64.6z"/></svg>,
  HubSpot: <svg viewBox="0 0 32 32" width="20" height="20"><path fill="#FF7A59" d="M22.4 11.7V8.5a2.5 2.5 0 1 0-2 0v3.2a8.5 8.5 0 0 0-3.5 1.4l-9.5-7.4a3 3 0 1 0-1.3 1.5l9.4 7.3a8.5 8.5 0 0 0 .1 9.6l-2.8 2.8a2.7 2.7 0 1 0 1.5 1.4l2.8-2.8a8.5 8.5 0 1 0 5.3-15.8zm-1 13.3a4.6 4.6 0 1 1 0-9.2 4.6 4.6 0 0 1 0 9.2z"/></svg>,
  Stripe: <svg viewBox="0 0 60 25" width="32" height="14"><path fill="#635BFF" d="M59.6 14.1c0-4.3-2-7.6-5.9-7.6-3.9 0-6.4 3.4-6.4 7.6 0 4.9 2.7 7.4 6.8 7.4 2 0 3.5-.5 4.6-1.1v-3.4c-1.1.6-2.4 1-4 1-1.6 0-3-.6-3.2-2.5h8c0-.2.1-.9.1-1.4zm-8.1-1.6c0-1.8 1.1-2.6 2.1-2.6 1 0 2.1.7 2.1 2.6h-4.2zm-10.4-6c-1.7 0-2.7.8-3.3 1.3l-.2-1H34v19.4l4.1-.9v-4.7c.6.4 1.5 1 3 1 3 0 5.8-2.4 5.8-7.7 0-4.8-2.8-7.4-5.8-7.4zm-1 11.3c-1 0-1.6-.4-2-.8V11.3c.4-.5 1-.9 2-.9 1.6 0 2.7 1.7 2.7 3.7 0 2-1.1 3.7-2.7 3.7zM27.7 5.5l4.1-.9V1.2l-4.1.9v3.4zm0 1.3h4.1v14.4h-4.1V6.8zm-4.4 1.2-.3-1.2h-3.5v14.4h4.1V11.6c1-1.3 2.6-1 3.1-.9V6.8c-.5-.2-2.4-.5-3.4 1.2zm-8.2-4.7-4 .8v13.2c0 2.4 1.8 4.2 4.3 4.2 1.4 0 2.4-.3 3-.5v-3.3c-.5.2-3.2 1-3.2-1.5v-5.9h3.2V6.8h-3.2l-.1-3.5zM4.2 11c0-.6.5-.9 1.4-.9 1.2 0 2.7.4 4 1.1V7.4c-1.4-.5-2.7-.7-4-.7-3.3 0-5.5 1.7-5.5 4.6 0 4.5 6.2 3.7 6.2 5.7 0 .8-.7 1-1.6 1-1.4 0-3.1-.5-4.5-1.3v3.9c1.5.6 3 .9 4.5.9 3.3 0 5.7-1.7 5.7-4.5 0-4.8-6.2-3.9-6.2-5.9z"/></svg>,
  Shopify: <svg viewBox="0 0 109 124" width="18" height="20"><path fill="#95BF47" d="M74 23c0-.4-.4-.6-.6-.6-.2 0-4 .1-4 .1s-2.6-2.6-2.9-2.9c-.3-.3-.9-.2-1.1-.1L64 20c-.1-.4-.4-1-.6-1.6-1-1.9-2.6-3-4.4-3h-.4c-.1-.2-.2-.3-.3-.4-.8-.9-1.9-1.3-3.1-1.3-2.5.1-5 1.9-7 5.1-1.5 2.3-2.6 5.1-2.9 7.3-2.9.9-4.9 1.5-5 1.5-1.4.5-1.5.5-1.7 1.9C38.5 30 35 56.4 35 56.4l28.5 5L78 57.7S74 23.4 74 23zM57.6 19c-1.3.4-2.7.8-4.2 1.3.5-1.7 1.4-3.4 2.5-4.6.4-.4 1-.9 1.7-1.2.6 1.4.7 3.3 0 4.5zm-3-5.7c.5 0 1 .1 1.4.3-.6.3-1.3.8-1.8 1.4-1.5 1.6-2.6 4.1-3.1 6.5-1.3.4-2.5.8-3.6 1.1.9-4.2 4.4-9.1 7.1-9.3zm-4.3 35.1c.2 2.5 6.5 3 6.9 8.6.3 4.4-2.3 7.4-6.1 7.6-4.6.3-7.1-2.4-7.1-2.4l1-4.1s2.5 1.9 4.5 1.7c1.3-.1 1.8-1.2 1.7-1.9-.2-3.3-5.4-3.1-5.8-8.2-.3-4.3 2.5-8.6 8.7-9 2.4-.2 3.7.5 3.7.5L52.6 47s-1.7-.8-3.6-.6c-2.9.2-3 2-2.7 3z"/><path fill="#5E8E3E" d="M73.4 22.4s-3.7.1-3.7.1-2.6-2.5-2.9-2.8c-.1-.1-.3-.2-.4-.2v18.4l14.5-3.6S74 23.3 74 22.7c-.1-.2-.4-.3-.6-.3z"/><path fill="#fff" d="m63.6 30.7-1.7 6.3s-1.9-.9-4.1-.7c-3.3.2-3.3 2.3-3.3 2.8.2 2.8 7.5 3.4 7.9 9.9.3 5.1-2.7 8.6-7.1 8.9-5.3.3-8.2-2.8-8.2-2.8L48.3 51s2.9 2.2 5.2 2c1.5-.1 2.1-1.4 2-2.2-.3-3.6-6.2-3.4-6.6-9.4-.3-5 3-10.1 10.1-10.5 2.9-.3 4.6.4 4.6.4z"/></svg>,
  Apollo: <svg viewBox="0 0 64 64" width="20" height="20"><circle cx="32" cy="32" r="28" fill="#22118b"/><path fill="#fff" d="M32 14 18 46h6l3-7h10l3 7h6L32 14zm-3 19 3-7 3 7h-6z"/></svg>,
  Attio: <svg viewBox="0 0 32 32" width="20" height="20"><circle cx="16" cy="16" r="15" fill="#1a1410"/><path fill="#f6f1e7" d="M16 8 9 24h3l1.5-3.5h5L20 24h3L16 8zm-1.5 9.5L16 14l1.5 3.5h-3z"/></svg>,
  Intercom: <svg viewBox="0 0 28 32" width="18" height="20"><path fill="#0057FF" d="M26 0H2C.9 0 0 .9 0 2v25c0 1.1.9 2 2 2h6l3 3 3-3h12c1.1 0 2-.9 2-2V2c0-1.1-.9-2-2-2zM10 8h2v10h-2V8zm-4 1h2v8H6V9zm-4 1h2v6H2v-6zm22 9.7c-.3.3-3.5 3.3-10 3.3s-9.7-3-10-3.3c-.4-.4-.5-1-.1-1.4.4-.4 1-.5 1.4-.1.1.1 2.7 2.6 8.7 2.6 6.1 0 8.6-2.5 8.7-2.6.4-.4 1-.4 1.4 0 .4.4.4 1.1-.1 1.5zM26 16h-2v-6h2v6zm-4 1h-2V9h2v8zm-4 1h-2V8h2v10z"/></svg>,
  Gmail: <svg viewBox="0 0 48 36" width="22" height="18"><path fill="#4285F4" d="M3 36h7V19L0 11.5V33a3 3 0 0 0 3 3z"/><path fill="#34A853" d="M38 36h7a3 3 0 0 0 3-3V11.5L38 19v17z"/><path fill="#FBBC04" d="M38 5v14l10-7.5V6.5C48 3.6 44.7 1.9 42.4 3.7L38 5z"/><path fill="#EA4335" d="M10 19V5l14 10.5L38 5v14L24 29.5 10 19z"/><path fill="#C5221F" d="M0 6.5v5L10 19V5L5.6 3.7C3.3 1.9 0 3.6 0 6.5z"/></svg>,
  "Microsoft Teams": <svg viewBox="0 0 32 32" width="20" height="20"><path fill="#5059C9" d="M19 11h7a2 2 0 0 1 2 2v7a4 4 0 0 1-4 4 5 5 0 0 1-5-5V11zm5-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path fill="#7B83EB" d="M14 11h-9a1 1 0 0 0-1 1v10a6 6 0 0 0 12 0V12a1 1 0 0 0-1-1zm-3.5-2a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/><path fill="#fff" d="M6 14h9v2h-3.5v8h-2v-8H6z"/></svg>,
  Notion: <svg viewBox="0 0 32 32" width="20" height="20"><path fill="#fff" stroke="#1a1410" strokeWidth="1.5" d="M5 6.5 19 5l8 1v20l-7 1.5L5 25.5V6.5z"/><path fill="#1a1410" d="m11 11 9 .5v11l-2 .3-7-9.5V22l-1.5.3V11z"/></svg>,
  PostHog: <svg viewBox="0 0 40 40" width="20" height="20"><path fill="#1D4AFF" d="M5 5h30v30H5z"/><path fill="#fff" d="m9 9 11 11h-7L9 16zm0 7 11 11h-7L9 23zm14 0 8 8h-8z"/></svg>,
  Sentry: <svg viewBox="0 0 32 32" width="20" height="20"><path fill="#362D59" d="M16 4a2 2 0 0 1 1.7 1l8 14a2 2 0 0 1-1.7 3h-3.5a13 13 0 0 0-9-12L14 6.6a2 2 0 0 1 2-2.6zm-4.5 7.5L9 14a10 10 0 0 1 8 8h-3a7 7 0 0 0-5.3-5.4L7 19c4 .5 7.2 3.6 7.7 7.5h-7a1 1 0 0 1-.9-1.5l4.7-13.5z"/></svg>,
  Datadog: <svg viewBox="0 0 32 32" width="20" height="20"><path fill="#632CA6" d="M28 4 16 28l-3-6 6-1-3-6 6-1-3-6 9-4z"/></svg>,
  DocuSign: <svg viewBox="0 0 32 32" width="20" height="20"><circle cx="16" cy="16" r="15" fill="#FFCC22"/><path fill="#1a1410" d="M11 9h7c4 0 7 3 7 7s-3 7-7 7h-7V9zm3 3v8h4c2.2 0 4-1.8 4-4s-1.8-4-4-4h-4z"/></svg>,
  Anthropic: <svg viewBox="0 0 64 64" width="20" height="20"><circle cx="32" cy="32" r="30" fill="#1a1410"/><path fill="#D4A27F" d="M21 19h6l9 26h-6l-2-6h-9l-2 6h-6l10-26zm1 15h6l-3-9-3 9zm17-15h5v26h-5z"/></svg>,
  OpenAI: <svg viewBox="0 0 32 32" width="20" height="20"><path fill="#1a1410" d="M28.7 13.6a6.3 6.3 0 0 0-.5-5.2 6.4 6.4 0 0 0-6.9-3.1 6.4 6.4 0 0 0-4.8-2.2 6.4 6.4 0 0 0-6.1 4.4 6.3 6.3 0 0 0-4.2 3 6.4 6.4 0 0 0 .8 7.6 6.3 6.3 0 0 0 .5 5.2 6.4 6.4 0 0 0 6.9 3.1 6.4 6.4 0 0 0 4.8 2.2 6.4 6.4 0 0 0 6.1-4.4 6.3 6.3 0 0 0 4.2-3 6.4 6.4 0 0 0-.8-7.6zM17.3 27.2a4.7 4.7 0 0 1-3-1.1l.2-.1 5-2.9c.3-.1.4-.4.4-.7v-7l2.1 1.2v5.9c0 2.6-2.1 4.7-4.7 4.7zM7.2 22.9a4.7 4.7 0 0 1-.6-3.2l.2.1 5 2.9c.3.1.5.1.8 0l6-3.5v2.4l-5.1 2.9a4.7 4.7 0 0 1-6.3-1.6zM5.9 11.6a4.7 4.7 0 0 1 2.4-2l-.1.4v5.8c0 .3.1.5.4.7l6 3.5-2.1 1.2-5.1-2.9a4.7 4.7 0 0 1-1.5-6.7zm17 4 -6-3.5 2.1-1.2 5.1 2.9a4.7 4.7 0 0 1-.7 8.4v-6c0-.3-.1-.5-.5-.6zm2.1-3.1-.2-.1-5-2.9c-.3-.2-.6-.2-.8 0l-6 3.5v-2.4l5.1-2.9a4.7 4.7 0 0 1 6.9 4.8zM12.4 16.7l-2.1-1.2v-5.9a4.7 4.7 0 0 1 7.7-3.6l-.2.1-5 2.9c-.3.1-.4.4-.4.7v7zm1.1-2.5L16 12.7l2.5 1.5v3l-2.5 1.5-2.5-1.5v-3z"/></svg>,
  Google: <svg viewBox="0 0 24 24" width="20" height="20"><path fill="#4285F4" d="M22 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.6c-.2 1.3-1 2.4-2 3.1v2.6h3.3c1.9-1.8 3.1-4.4 3.1-7.5z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.5c-.9.6-2.1 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1H3v2.6C4.7 19.9 8.1 22 12 22z"/><path fill="#FBBC04" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3a10 10 0 0 0 0 9.2L6.4 14z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9C16.9 2.8 14.7 2 12 2 8.1 2 4.7 4.1 3 7.4l3.4 2.6C7.2 7.6 9.4 5.9 12 5.9z"/></svg>,
  Bedrock: <svg viewBox="0 0 32 32" width="20" height="20"><path fill="#FF9900" d="M16 4 4 11v10l12 7 12-7V11L16 4zm0 4 8 4.7-8 4.7-8-4.7L16 8z"/></svg>,
  "Azure OAI": <svg viewBox="0 0 32 32" width="20" height="20"><path fill="#0078D4" d="M14 4 4 26h7l3-7-5-2 11-9zm4 0 10 22h-7l-2-5 5-2-6-15z"/></svg>,
};

// Sidebar nav config.
window.AF2_NAV = [
  { section: "Run" },
  { id: "home",        label: "Home",          icon: "home" },
  { id: "missions",    label: "Missions",      icon: "target",   badge: "6" },
  { id: "approvals",   label: "Approvals",     icon: "stamp",    badge: "5", badgeClay: true },
  { id: "activity",    label: "Activity",      icon: "pulse" },
  { section: "Workforce" },
  { id: "team",        label: "Team",          icon: "users" },
  { id: "hire",        label: "Hire",          icon: "plus" },
  { id: "budget",      label: "Budget",        icon: "wallet" },
  { section: "Build" },
  { id: "studio",      label: "Studio",        icon: "wand" },
  { id: "library",     label: "Library",       icon: "book" },
  { section: "Connect" },
  { id: "integrations",label: "Integrations",  icon: "plug" },
  { id: "models",      label: "Models",        icon: "spark" },
  { id: "settings",    label: "Settings",      icon: "cog" },
];

window.AF2_ICON = (name) => {
  const p = { home: "M3 11 12 3l9 8M5 9.5V21h14V9.5", target:"M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0", stamp:"M5 21h14M7 17h10v-3H7zM12 14V9a3 3 0 1 1 6 0M12 14V9a3 3 0 1 0-6 0", pulse:"M3 12h4l2-7 4 14 2-7h6", users:"M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm8 1a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M16 21v-2a4 4 0 0 0-3-3.9", plus:"M12 5v14M5 12h14", wallet:"M3 7h18v12H3zM3 7l4-3h10l4 3M16 13h2", wand:"M5 19 19 5M14 4l1 3 3 1-3 1-1 3-1-3-3-1 3-1zM4 12l.7 2 2 .7-2 .7L4 17l-.7-1.7L1.5 14.7l2-.7z", book:"M4 5v14a2 2 0 0 0 2 2h14V3H6a2 2 0 0 0-2 2zM8 7h10M8 11h10M8 15h6", plug:"M9 2v6m6-6v6M5 8h14v3a7 7 0 0 1-7 7 7 7 0 0 1-7-7zM12 18v3", spark:"M12 3v3M12 18v3M5 12H2M22 12h-3M7 7l-2-2M19 19l-2-2M7 17l-2 2M19 5l-2 2M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", cog:"M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM19.4 15a8 8 0 0 0 0-6l2-1.5-2-3.5-2.4 1a8 8 0 0 0-5-3l-.5-2.5h-4l-.5 2.5a8 8 0 0 0-5 3l-2.4-1-2 3.5L0 9a8 8 0 0 0 0 6L-2 16.5l2 3.5 2.4-1a8 8 0 0 0 5 3l.5 2.5h4l.5-2.5a8 8 0 0 0 5-3l2.4 1 2-3.5z" }[name];
  return <svg className="af2-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={p}/></svg>;
};
