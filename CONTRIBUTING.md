# Contributing

## Branch And PR Flow

AutoFlow uses a staging-first promotion model:

1. Create your feature branch from `staging`.
2. Open feature PRs against `staging`.
3. Let staging CI, preview deploys, and QA checks pass there first.
4. Promote `staging` to `master` with a dedicated PR after validation.

Do not open direct feature PRs to `master`. Production only accepts the promoted `staging` branch.

If a feature or Dependabot PR is opened against `master` by mistake, `.github/workflows/auto-retarget-master-prs.yml` automatically retargets it to `staging`. The only PRs that should remain on `master` are dedicated `staging` -> `master` promotion PRs.

## Dependabot Policy

Dependabot PRs must also target `staging`. The repository config in `.github/dependabot.yml` sets `target-branch: staging` for every package ecosystem so dependency updates follow the same gate as human-authored changes.

If stale Dependabot PRs are still open against `master`, close them after the staging-targeting config merges and allow Dependabot to reopen them against `staging`.

## Before Opening A PR

1. Run the tests relevant to your change.
2. Confirm your branch is up to date with `staging`.
3. Document any deployment or operational impact in the PR description.

## CI and protected branches

Protected-branch required checks are defined in `infra/branch-protection/required-checks.json`.
Do not hard-code required check names in workflow defaults or shell fallbacks.

When you add or rename a required CI job:

1. Update the job `name:` in the workflow that reports the status.
2. Update `infra/branch-protection/required-checks.json`.
3. Run `node scripts/validate-required-checks.js` locally.

## Matrix-job gotcha

GitHub reports matrix jobs as `Job Name (value)`, not the bare job name.
If a protected branch needs one stable required context, add a non-matrix summary job with the stable name and require that summary check instead of the per-matrix expansions.
