# Brand Asset Infrastructure (ALT-1363)

This directory contains the DevOps deliverables for standing up `autoflow-brand` as the source of truth for brand assets and publishing immutable CDN artifacts to Cloudflare R2.

## What is included

- `terraform/cloudflare-r2/` — IaC for R2 bucket and `cdn.helloautoflow.com` custom domain.
- `scripts/bootstrap_autoflow_brand_repo.sh` — repository scaffold script for the required directory layout and placeholder `LICENSE.md` files.
- `scripts/publish_to_r2.sh` — deterministic uploader for versioned CDN paths (`v{semver}`).
- `scripts/sync_brand_mempalace.sh` — syncs published asset metadata to MemPalace `brand/*`.
- `workflows/publish-cdn.yml` — GitHub Actions template for R2 publish on merge to `main`.
- `workflows/sync-mempalace.yml` — GitHub Actions template for MemPalace metadata sync.

## Required external access

This run did not include authenticated GitHub org admin access or Cloudflare credentials, so provisioning and repo creation must be executed after secrets are supplied.

## Target repo (`autoflow-brand`) setup order

1. Create private GitHub repo `autoflow-brand` under the org.
2. Run `scripts/bootstrap_autoflow_brand_repo.sh`.
3. Copy workflow templates from `infra/brand-assets/workflows/` into `.github/workflows/` in `autoflow-brand`.
4. Copy scripts from `infra/brand-assets/scripts/` into `scripts/` in `autoflow-brand`.
5. Apply Terraform from `infra/brand-assets/terraform/cloudflare-r2/`.
6. Add required GitHub Actions secrets (see runbook).
7. Enforce branch protection for `main` with 1+ PR review.

## Version contract

- `VERSION` file in repo root must contain semantic version (`x.y.z`).
- Publish pipeline writes assets to `v${VERSION}/...`.
- Runtime consumers must pin to an explicit version path (immutable URLs).
