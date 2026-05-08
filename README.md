# AutoFlow

Hire a team of AI agents that actually ship.

AutoFlow is the workplace for autonomous agents — describe your mission, get a draft hiring plan, confirm the agents, connect your tools, and watch routines run with human approval where it matters. Think n8n + Zapier + an agent orchestration layer in one product.

> **Live demo:** [helloautoflow.com/demo](https://helloautoflow.com/demo)
> **Docs:** [docs.helloautoflow.com](https://docs.helloautoflow.com)
> **Status:** open-source, pre-launch (no paying customers yet). The codebase is mature; the customer loop is being compressed in [the production-ready initiative](https://linear.app/helloautoflow/initiative/production-ready-saas-first-paying-customer-6137d1a98469).

## What AutoFlow does

1. **Mission intake.** Describe what your business is trying to do.
2. **Hiring plan.** An LLM drafts an org chart of agents — roles, model tiers, tools, budgets, reporting lines.
3. **Confirm.** You review and edit the plan; agents are provisioned with persistent identity.
4. **Connect.** Wire up your tools via OAuth (Slack, Gmail, HubSpot, Linear, GitHub, Stripe, etc.).
5. **Build routines.** Drag-and-drop workflows in Studio — triggers, actions, LLM calls, conditions, outputs.
6. **Run with guardrails.** Routines fire on schedule or trigger; approvals gate the risky steps; budgets cap the spend; activity feed shows everything.

Bring your own LLM keys (Anthropic, OpenAI, Google, Bedrock, Azure) or use AutoFlow’s hosted models with tier routing.

## Repo layout

| Path | What lives there |
|---|---|
| `src/` | Backend (Express + TypeScript). Engine, auth, billing, integrations, workflows, agents, approvals, tickets. |
| `dashboard/` | Customer-facing app (Vite + React 18 + Tailwind + react-router 7). |
| `landing/` | Marketing site (React Router 7 + Sanity CMS + Stripe Checkout). |
| `docs/` | Public documentation site. |
| `autoflow-brand/` | Brand assets and Storybook-style demo of the design system. |
| `migrations/` | Postgres migrations (raw SQL). Supabase-managed migrations live in `supabase/migrations/`. |
| `infra/` | Deploy configs, runbooks, infrastructure-as-code. |
| `docker/` | Container definitions for backend + frontend. |
| `.github/workflows/` | CI/CD (Cloudflare Pages, Fly.io, release-please). |

## Stack

| Layer | Service |
|---|---|
| Frontend hosting | Cloudflare Pages/Workers |
| Backend compute | Fly.io (`autoflow-fastapi-{dev,staging,production}`) |
| Database + auth (CIAM) | Supabase |
| Cache + queue broker | Upstash Redis |
| Object storage | Cloudflare R2 |
| Secrets | Infisical (see [`docs/secrets.md`](docs/secrets.md)) |
| Observability | Sentry, Datadog, Cloudflare Analytics |
| Billing | Stripe |
| Email / messaging | Slack, Intercom (existing integrations; both used internally) |

## Quick start

### Prerequisites

- Node.js 18+
- Docker (optional, for local Postgres + Redis)
- An [Infisical](https://infisical.com) account ([HEL-9](https://linear.app/helloautoflow/issue/HEL-9) sets up the workspace)

### Run the API locally

```bash
git clone https://github.com/bdunk881/paperclipai.git
cd paperclipai
npm install

# Pull dev secrets from Infisical and start the API
infisical login                                # one-time
infisical run --env=dev -- npm run dev
```

The API is on `http://localhost:8000`. Hit `/health` to verify.

### Run the dashboard

```bash
cd dashboard
infisical run --env=dev -- npm run dev
```

Dashboard at `http://localhost:5173`.

### Run via Docker (optional, for parity with prod)

```bash
cp .env.local.example .env.local              # local-only secrets (DB password, etc.)
docker compose up                              # spins Postgres + Redis + backend + dashboard
```

## Branching + release flow

See [`CLAUDE.md`](CLAUDE.md) for the canonical rules. TL;DR:

- Feature work happens on `feature/*` branches off `dev`.
- `dev` is main. Currently has minimum protection (no force-push, no delete, CI must pass).
- `staging` is the UAT branch. PRs into staging require approval and a green CI build.
- `master` is the production branch. Currently frozen on an older build while we settle the v2 redesign and the production-ready initiative; new code lands here only after staging UAT.

## Testing

```bash
# Backend
npm test                                       # unit + integration
npm run test:engine                            # workflow engine only
npm run test:templates                         # template smoke tests

# Dashboard
cd dashboard && npm test                       # vitest unit
cd dashboard && npm run e2e                    # Playwright e2e

# Type check anywhere
npm run type-check
```

Every PR runs the full suite via [`ci.yml`](.github/workflows/ci.yml).

## Contributing

This is currently a solo-founder + AI-agent project. Branch protocol in [`CLAUDE.md`](CLAUDE.md). Issue tracker: [Linear `Helloautoflow` team](https://linear.app/helloautoflow). The production roadmap is the [Production-Ready SaaS initiative](https://linear.app/helloautoflow/initiative/production-ready-saas-first-paying-customer-6137d1a98469).

If you’d like to contribute as an outside human, open an issue first — the codebase is changing fast and a quick alignment saves wasted work.

## License

MIT. See [`LICENSE`](LICENSE).
