# Contributing

## Branch And PR Flow

AutoFlow uses a staging-first promotion model:

1. Create your feature branch from `staging`.
2. Open feature PRs against `staging`.
3. Let staging CI, preview deploys, and QA checks pass there first.
4. Promote `staging` to `master` with a dedicated PR after validation.

Do not open direct feature PRs to `master`. Production only accepts the promoted `staging` branch.

## Dependabot Policy

Dependabot PRs must also target `staging`. The repository config in `.github/dependabot.yml` sets `target-branch: staging` for every package ecosystem so dependency updates follow the same gate as human-authored changes.

If stale Dependabot PRs are still open against `master`, close them after the staging-targeting config merges and allow Dependabot to reopen them against `staging`.

## Before Opening A PR

1. Run the tests relevant to your change.
2. Confirm your branch is up to date with `staging`.
3. Document any deployment or operational impact in the PR description.
