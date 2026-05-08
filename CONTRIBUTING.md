# Contributing

> The canonical operating manual for everyone — humans and agents — touching this repo is [`AGENTS.md`](AGENTS.md). This file covers the contributing-specific bits; if anything here conflicts with `AGENTS.md`, that file wins.

## Branch and PR flow

AutoFlow uses a **dev-first** flow today. `dev` is the integration branch; `staging` is the UAT promotion branch; `master` is currently frozen on an older build while the [Production-Ready SaaS initiative](https://linear.app/helloautoflow/initiative/production-ready-saas-first-paying-customer-6137d1a98469) settles the v2 redesign and platform foundations.

| Branch | Role |
|---|---|
| `dev` | Main integration branch. All feature work lands here first. |
| `staging` | UAT — promoted from `dev` via a dedicated PR after dev validation passes. |
| `master` | Production. Frozen on an older build until the initiative explicitly opens the gate. |

### How to open a PR

1. **Branch from `dev`.** Humans use `feature/<short-name>`; agents working a Linear ticket use the `gitBranchName` Linear provides on the issue (`brad/hel-<n>-<slug>`).
2. **Open the PR into `dev`** in the same heartbeat as the first push. Reference the Linear ticket with `Closes HEL-N` in the body.
3. **Let CI run.** Required checks must pass before merge.
4. **Enable auto-merge** after CI passes if you want the merge to happen as soon as the gates clear.
5. **Promote `dev` → `staging`** with a separate PR once integration is stable.
6. **Promote `staging` → `master`** with a separate PR after UAT — but only when the initiative opens the gate.

### Hard rules

- Never push directly to `dev`, `staging`, or `master`.
- Never use `--no-verify`, `--no-gpg-sign`, or any other hook bypass.
- Never modify branch protection settings.
- Never force-push a published branch.
- Never open a feature PR directly against `master`. (`auto-retarget-master-prs.yml` will redirect it, but file PRs against `dev` from the start.)

## Dependabot policy

Dependabot PRs target `staging` today (per `.github/dependabot.yml`). This config is a hold-over from the staging-first era and is being updated alongside the dev-first cutover — see issues filed under [P0 Foundations](https://linear.app/helloautoflow/project/p0-foundations-aaa49ef5d956) for the migration.

When the cutover lands, Dependabot PRs will retarget to `dev`. Until then, follow whatever target your Dependabot PR was opened against — and don't manually retarget without coordinating.

If stale Dependabot PRs accumulate against the wrong base after a cutover, close them and let Dependabot reopen against the right base.

## Before opening a PR

1. Run the tests relevant to your change locally:
   ```bash
   npm test                                # backend / API tests
   cd dashboard && npm test                # dashboard unit (vitest)
   npm run type-check                      # in any package
   ```
2. Confirm your branch is up to date with `dev`:
   ```bash
   git fetch origin
   git rebase origin/dev
   ```
3. Document deployment or operational impact in the PR description (env vars added, migrations included, secret rotations needed).

## CI and protected branches

Protected-branch required checks are defined in `infra/branch-protection/required-checks.json`. **Don't hard-code required check names** in workflow defaults or shell fallbacks — pull from that file.

When you add or rename a required CI job:

1. Update the job `name:` in the workflow that reports the status.
2. Update `infra/branch-protection/required-checks.json`.
3. Run `node scripts/validate-required-checks.js` locally.

### Matrix-job gotcha

GitHub reports matrix jobs as `Job Name (value)`, not the bare job name. If a protected branch needs one stable required context, add a non-matrix summary job with the stable name and require that summary check instead of the per-matrix expansions.

## Working with Linear tickets

Every PR closes (or relates to) a Linear ticket. The flow:

1. Pick a ticket from the [Production-Ready SaaS initiative](https://linear.app/helloautoflow/initiative/production-ready-saas-first-paying-customer-6137d1a98469) — phases P0 through P7.
2. Move the ticket to **In Progress** when you start.
3. Use Linear's suggested branch name (`gitBranchName` on the issue).
4. Comment the PR URL on the Linear ticket once it's open.
5. Linear's GitHub integration auto-closes the ticket when the PR merges (via `Closes HEL-N` in the PR body).

Multi-agent assignment uses Linear's native `delegate` field (Cursor / Codex / Claude). All three agents work as Brad's Linear identity but the delegate determines who picks up. See [`AGENTS.md`](AGENTS.md) → "How agents work tickets" for the full protocol.

## Glossary, secrets, and design references

- [`AGENTS.md`](AGENTS.md) — full agent + contributor operating manual
- [`docs/glossary.md`](docs/glossary.md) — canonical product nouns (in flight: HEL-6 / HEL-43)
- [`docs/secrets.md`](docs/secrets.md) — Infisical layout + rotation policy (in flight: HEL-9)
- [`docs/design/v2/`](docs/design/v2/) — canonical v2 editorial workplace design tokens + reference HTMLs (in flight: HEL-49)
- [`docs/design/legacy/`](docs/design/legacy/) — original Electric Lab pass for reference

## When this file is wrong

If you find this file describes a flow that no longer matches reality, **fix the file in the same PR** as whatever change made it wrong. Drift in `CONTRIBUTING.md` and `AGENTS.md` is itself a P0 — it leads contributors and agents astray and the cost compounds.
