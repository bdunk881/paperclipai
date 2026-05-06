# AutoFlow Branch And PR Discipline

## Required Flow

- Create every change on a `feature/*` branch.
- Open every agent PR into `dev`.
- Do not push directly to `dev`, `staging`, or `master`.
- Promote `dev` to `staging` with a PR after dev validation passes.
- Promote `staging` to `master` with a PR after UAT passes and staging remains green.

## Approval Rules

- `dev` accepts feature PRs for integration and preview testing.
- `staging` promotion requires Brad approval before merge.
- `master` promotion requires Brad approval and a staging-first gate before merge.

## Environment Rules

- `dev` uses the isolated `autoflow-dev` Supabase project.
- `staging` and `master` share the production Supabase project so beta accounts survive promotion.
- Never point `dev` code or `dev` deploy secrets at production Supabase credentials.

## Operational Rules

- Open the PR in the same heartbeat as the first pushed commit.
- Enable auto-merge on every PR after creation.
- If a deploy path or secret is missing, document it in the issue before ending the heartbeat.
