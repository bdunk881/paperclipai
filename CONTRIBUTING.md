# Contributing

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
