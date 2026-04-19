#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Missing required env var: ${name}" >&2
    exit 1
  fi
}

require_env ASSET_VERSION

ROOT_DIR="${1:-.}"
PREFIX="v${ASSET_VERSION}"
SKIP_R2_UPLOAD="${SKIP_R2_UPLOAD:-0}"

if [ "${SKIP_R2_UPLOAD}" != "1" ]; then
  require_env CLOUDFLARE_ACCOUNT_ID
  require_env R2_BUCKET_NAME
  require_env CLOUDFLARE_R2_ACCESS_KEY_ID
  require_env CLOUDFLARE_R2_SECRET_ACCESS_KEY

  if ! command -v aws >/dev/null 2>&1; then
    echo "aws CLI is required" >&2
    exit 1
  fi

  ENDPOINT="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"
  export AWS_ACCESS_KEY_ID="${CLOUDFLARE_R2_ACCESS_KEY_ID}"
  export AWS_SECRET_ACCESS_KEY="${CLOUDFLARE_R2_SECRET_ACCESS_KEY}"
  export AWS_DEFAULT_REGION="auto"

  echo "Publishing brand assets to s3://${R2_BUCKET_NAME}/${PREFIX}"
  for dir in logos tokens motion templates direction; do
    if [ -d "${ROOT_DIR}/${dir}" ]; then
      aws --endpoint-url "${ENDPOINT}" s3 sync "${ROOT_DIR}/${dir}" \
        "s3://${R2_BUCKET_NAME}/${PREFIX}/${dir}" \
        --exclude ".DS_Store" \
        --cache-control "public,max-age=31536000,immutable"
    fi
  done
fi

MANIFEST_FILE="${ROOT_DIR}/brand-manifest-${ASSET_VERSION}.json"
TMP_MANIFEST="${MANIFEST_FILE}.tmp"

echo "{" >"${TMP_MANIFEST}"
echo "  \"version\": \"${ASSET_VERSION}\"," >>"${TMP_MANIFEST}"
echo "  \"generatedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"," >>"${TMP_MANIFEST}"
echo "  \"assets\": [" >>"${TMP_MANIFEST}"

FIRST=1
while IFS= read -r -d '' file; do
  rel="${file#${ROOT_DIR}/}"
  hash="$(shasum -a 256 "${file}" | awk '{print $1}')"
  url="https://cdn.helloautoflow.com/${PREFIX}/${rel}"
  if [ "${FIRST}" -eq 0 ]; then
    echo "," >>"${TMP_MANIFEST}"
  fi
  FIRST=0
  printf '    {"path":"%s","sha256":"%s","cdnUrl":"%s"}' "${rel}" "${hash}" "${url}" >>"${TMP_MANIFEST}"
done < <(find "${ROOT_DIR}" -type f \( -path "${ROOT_DIR}/logos/*" -o -path "${ROOT_DIR}/tokens/*" -o -path "${ROOT_DIR}/motion/*" -o -path "${ROOT_DIR}/templates/*" -o -path "${ROOT_DIR}/direction/*" \) -print0 | sort -z)

echo >>"${TMP_MANIFEST}"
echo "  ]" >>"${TMP_MANIFEST}"
echo "}" >>"${TMP_MANIFEST}"
mv "${TMP_MANIFEST}" "${MANIFEST_FILE}"

if [ "${SKIP_R2_UPLOAD}" != "1" ]; then
  aws --endpoint-url "${ENDPOINT}" s3 cp "${MANIFEST_FILE}" \
    "s3://${R2_BUCKET_NAME}/${PREFIX}/manifest.json" \
    --cache-control "public,max-age=300"
fi

echo "Publish completed: ${MANIFEST_FILE}"
