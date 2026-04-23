# Brand Assets CDN Runbook

Issue: [ALT-1363](/ALT/issues/ALT-1363)

## Objective

Run immutable, repeatable brand asset delivery:

- Source of truth: `autoflow-brand` GitHub repo
- Delivery: Cloudflare R2 at `https://cdn.helloautoflow.com/v{semver}/...`
- Metadata index: MemPalace `brand/*`

## One-time bootstrap

1. Create private GitHub repo `autoflow-brand` under the org.
2. Copy in:
   - `infra/brand-assets/scripts/*` -> `autoflow-brand/scripts/`
   - `infra/brand-assets/workflows/*` -> `autoflow-brand/.github/workflows/`
3. Run `scripts/bootstrap_autoflow_brand_repo.sh`.
4. Apply Terraform in `infra/brand-assets/terraform/cloudflare-r2/`.
5. Enforce branch protection on `main` (at least one PR review).

## Required GitHub Actions secrets

- `CLOUDFLARE_ACCOUNT_ID`
- `R2_BUCKET_NAME`
- `CLOUDFLARE_R2_ACCESS_KEY_ID`
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`
- `MEMPALACE_API_URL`
- `MEMPALACE_API_TOKEN`

## Publish flow

1. Update `VERSION` in `autoflow-brand`.
2. Merge PR into `main`.
3. `publish-cdn` runs:
   - uploads `logos/`, `tokens/`, `motion/`, `templates/`, `direction/` to `v{VERSION}/`
   - writes `manifest.json`
4. `sync-mempalace` runs:
   - syncs each artifact to key format `brand/{relative_path}`

## Rollback

Because URLs are immutable and versioned:

1. Repoint consumers to previous known-good `v{semver}` path.
2. If needed, revert the merge commit and republish a newer corrective version.

## Operational checks

- `HEAD https://cdn.helloautoflow.com/v{semver}/manifest.json` returns `200`
- random sample assets return expected `cache-control` with `immutable`
- MemPalace lookup for `brand/*` returns new `version` and `cdn_url`
