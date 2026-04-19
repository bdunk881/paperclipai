#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Missing required env var: ${name}" >&2
    exit 1
  fi
}

require_env MEMPALACE_API_URL
require_env MEMPALACE_API_TOKEN
require_env ASSET_VERSION

MANIFEST_PATH="${1:-brand-manifest-${ASSET_VERSION}.json}"

if [ ! -f "${MANIFEST_PATH}" ]; then
  echo "Manifest not found: ${MANIFEST_PATH}" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

count="$(jq '.assets | length' "${MANIFEST_PATH}")"
echo "Syncing ${count} brand artifacts to MemPalace namespace brand/*"

jq -c '.assets[]' "${MANIFEST_PATH}" | while IFS= read -r asset; do
  path="$(echo "${asset}" | jq -r '.path')"
  sha="$(echo "${asset}" | jq -r '.sha256')"
  cdn_url="$(echo "${asset}" | jq -r '.cdnUrl')"

  payload="$(jq -n \
    --arg key "brand/${path}" \
    --arg version "${ASSET_VERSION}" \
    --arg git_path "${path}" \
    --arg cdn_url "${cdn_url}" \
    --arg sha256 "${sha}" \
    '{
      key: $key,
      value: {
        version: $version,
        git_path: $git_path,
        cdn_url: $cdn_url,
        sha256: $sha256
      }
    }')"

  curl -sS -X POST \
    -H "Authorization: Bearer ${MEMPALACE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    "${MEMPALACE_API_URL%/}/brand/artifacts" \
    -d "${payload}" >/dev/null
done

echo "MemPalace sync complete"
