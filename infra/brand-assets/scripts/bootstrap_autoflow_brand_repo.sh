#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${1:-.}"

mkdir -p \
  "${TARGET_DIR}/logos/integrations" \
  "${TARGET_DIR}/logos/product" \
  "${TARGET_DIR}/logos/wordmark" \
  "${TARGET_DIR}/tokens" \
  "${TARGET_DIR}/motion" \
  "${TARGET_DIR}/templates/marketing" \
  "${TARGET_DIR}/direction" \
  "${TARGET_DIR}/scripts" \
  "${TARGET_DIR}/.github/workflows"

if [ ! -f "${TARGET_DIR}/VERSION" ]; then
  echo "0.1.0" >"${TARGET_DIR}/VERSION"
fi

if [ ! -f "${TARGET_DIR}/README.md" ]; then
  cat >"${TARGET_DIR}/README.md" <<'MD'
# autoflow-brand

Canonical source of truth for AutoFlow brand assets.

## Required structure

- `logos/` — product, wordmarks, integration logos (+ per-vendor `LICENSE.md`)
- `tokens/` — design tokens as JSON
- `motion/` — Lottie JSON and motion primitives
- `templates/marketing/` — campaign-ready templates
- `direction/` — positioning brief, competitive audit, visual direction docs

## Versioning

Use the `VERSION` file for immutable CDN publishes to:

`https://cdn.helloautoflow.com/v{semver}/...`
MD
fi

# Add explicit placeholder license for any future vendor logo directories.
if [ ! -f "${TARGET_DIR}/logos/README.md" ]; then
  cat >"${TARGET_DIR}/logos/README.md" <<'MD'
# logos/

Every vendor subdirectory under `logos/integrations/` must include:

- `LICENSE.md` (license + usage restrictions)
- source attribution
- approved export files
MD
fi

echo "Repository scaffold created at ${TARGET_DIR}"
