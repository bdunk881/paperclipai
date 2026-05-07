# AutoFlow — agent + contributor playbook

This file is the source of truth for branch protocol, environment rules, and how AI agents should operate in this repo. Both human contributors and AI agents (Claude Code, the cloud routine, ad-hoc agents) MUST follow it.

## Branch flow (current reality)

| Branch | Role | Protection (today) | Protection (target — see [HEL-7](https://linear.app/helloautoflow/issue/HEL-7)) |
|---|---|---|---|
| `dev` | Main / integration | None today | No force-push, no delete, CI green required |
| `staging` | UAT | Open to direct PRs from `dev` (no gating today) | PR + 1 approval + green CI; protected against direct push |
| `master` | Production (currently frozen on an older build) | Open today | PR + 1 approval + staging-first promotion gate |

`master` is intentionally lagging while the [Production-Ready SaaS initiative](https://linear.app/helloautoflow/initiative/production-ready-saas-first-paying-customer-6137d1a98469) settles the v2 redesign and the production foundation. Don’t promote to `master` until the initiative explicitly opens that gate.

### How to contribute a change

1. Branch from `dev`: `git checkout -b feature/<short-name>` (humans) or `brad/hel-<n>-<slug>` (agents working a Linear ticket).
2. Open the PR into `dev` in the same heartbeat as the first push.
3. Enable auto-merge after CI passes.
4. Promotion to `staging`: separate PR, requires approval.
5. Promotion to `master`: separate PR, requires approval **and** a clean staging history.

**Never:**
- Push directly to `dev`, `staging`, or `master`.
- Use `--no-verify`, `--no-gpg-sign`, or any other hook bypass.
- Modify branch protection settings outside [HEL-7](https://linear.app/helloautoflow/issue/HEL-7).
- Force-push a published branch.

## Environments

| Env | Supabase project | Fly app | Cloudflare Pages | Notes |
|---|---|---|---|---|
| Dev | `autoflow-dev` (isolated) | `autoflow-fastapi-dev` | `autoflow-dashboard` (preview) | Safe to break. Used for feature integration. |
| Staging | Production Supabase project (UAT data preserved) | `autoflow-fastapi-staging` | `autoflow-dashboard-staging` | Beta accounts live here; survives promotion. |
| Production | Production Supabase project | `autoflow-fastapi-production` | `autoflow-dashboard` | Real customers (when they arrive). |

**Never point dev code or dev deploy secrets at the production Supabase project.** This is the single most common foot-gun in this repo.

## Secrets

Single source of truth: **Infisical**. See [`docs/secrets.md`](docs/secrets.md) for the full procedure.

- `infisical login` once per machine.
- `infisical run --env=<env> -- <command>` for every dev command.
- CI pulls via `Infisical/secrets-action@v1`.
- Fly machines pull via `infisical run` in the Dockerfile entrypoint.
- Cloudflare Pages syncs from Infisical.

Never paste a secret into a PR, a comment, a config file, or a chat message. If you find one in git history, [HEL-9](https://linear.app/helloautoflow/issue/HEL-9) defines the rotation playbook.

## Operating rules for AI agents

This repo is largely agent-driven. The cloud routine ([`AutoFlow ticket runner`](https://claude.ai/code/routines/trig_01Wge2tqiDc16KTbVVtfsVHk)) polls Linear hourly and works any ticket moved to `In Progress`. Local CLI agents (Claude Code, Codex, etc.) work the same protocol.

### When you start a Linear ticket

1. Move the ticket to `In Progress` (the routine does this automatically when picking from Todo).
2. Comment a kickoff note: what you plan to do, any constraints (e.g., “no `gh` auth this session, will draft only”).
3. Branch off `dev` using the suggested `gitBranchName` Linear provides (it’s stable across re-opens).
4. Read the issue description fully — it IS the spec.
5. Do the work. Don’t add scope. If you spot something unrelated, file a new Linear ticket and continue with the original.

### When you finish a ticket

1. Push the branch and open a PR into `dev` with `Closes HEL-N` in the body.
2. Comment the PR URL on the Linear ticket.
3. Once CI is green and the PR is merged: mark the Linear ticket `Done`.
4. Auto-promote: pull the highest-priority `Todo` ticket in the *same phase project* whose `blockedBy` is satisfied. Move it to `In Progress`. Comment “Auto-promoted from HEL-X” on the new ticket. **Never advance to a different phase project automatically — that’s a human decision.**

### When to stop

Hard-stop conditions (label the ticket and exit):

- 3 consecutive CI failures despite reasonable fix attempts → label `ci-failure`, comment the failure summary, stop.
- Ambiguity in the spec that you can’t resolve from the repo, the linked plan, or the canonical glossary at [`docs/glossary.md`](docs/glossary.md) (after [HEL-6](https://linear.app/helloautoflow/issue/HEL-6) lands) → label `needs-human`, comment the precise question, stop.
- Linear MCP unavailable → exit with a final message; don’t fall back to direct API calls without an explicit token.
- `gh` CLI unauthenticated → don’t attempt commits; comment the gap and exit.

### Hard “never” list

- Never delete or change priority on a Linear ticket.
- Never modify GitHub branch protection.
- Never bypass CI or commit hooks.
- Never push to `dev`/`staging`/`master` directly.
- Never expand scope without filing a separate ticket.
- Never paste a real secret value into Linear, GitHub, Slack, or any chat surface.

## Memory + plans

- Persistent agent context for *this machine* (Brad’s local) lives at `C:\Users\bdunk\CLAUDE.md` (machine-level setup) and `C:\Users\bdunk\.claude\memory\*.md` (auto-memory).
- Project-level decisions for AutoFlow live in this file (`CLAUDE.md`) and in [`docs/`](docs/).
- The current product roadmap is [`docs/roadmap.md`](docs/roadmap.md) — generated from the [Production-Ready SaaS initiative](https://linear.app/helloautoflow/initiative/production-ready-saas-first-paying-customer-6137d1a98469).

## Ops cadence

- **Status updates**: weekly summary in the AutoFlow Linear project’s status field.
- **Sentry / alerts**: founder-only on-call. Pages forward to phone via Sentry → PagerDuty (after [HEL-#](https://linear.app/helloautoflow/team/HEL/active)).
- **Backups**: Supabase automated daily; restore drill scheduled in P5.
- **Secrets audit**: monthly per [`docs/secrets.md`](docs/secrets.md).

## When this file is wrong

If you (a future agent or contributor) find this file describes a flow that no longer matches reality, **fix the file in the same PR** as whatever change made it wrong. Drift in `CLAUDE.md` is itself a P0 — it leads agents astray and the cost compounds.
