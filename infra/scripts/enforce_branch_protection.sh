#!/usr/bin/env bash
set -euo pipefail

if [ -z "${GH_TOKEN:-}" ]; then
  echo "GH_TOKEN is required"
  exit 1
fi

if [ -z "${GITHUB_REPOSITORY:-}" ]; then
  echo "GITHUB_REPOSITORY is required (owner/repo)"
  exit 1
fi

REPO="${GITHUB_REPOSITORY}"
API="https://api.github.com"
TARGET_BRANCHES=("main" "master" "staging")
REQUIRED_CHECKS="${REQUIRED_CHECKS:-Docker Build Check}"

IFS=',' read -r -a CHECK_CONTEXTS <<<"$REQUIRED_CHECKS"
for i in "${!CHECK_CONTEXTS[@]}"; do
  CHECK_CONTEXTS[$i]="$(echo "${CHECK_CONTEXTS[$i]}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
done

CONTEXTS_JSON="$(printf '%s\n' "${CHECK_CONTEXTS[@]}" | jq -R . | jq -s .)"

for BRANCH in "${TARGET_BRANCHES[@]}"; do
  STATUS_CODE="$(curl -sS -o /dev/null -w "%{http_code}" \
    -X GET \
    -H "Authorization: Bearer ${GH_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "${API}/repos/${REPO}/branches/${BRANCH}")"

  if [ "$STATUS_CODE" = "404" ]; then
    echo "Skipping missing branch: ${BRANCH}"
    continue
  fi

  if [ "$STATUS_CODE" != "200" ]; then
    echo "Unable to read branch ${BRANCH} (status ${STATUS_CODE})"
    exit 1
  fi

  echo "Applying branch protection for ${BRANCH} on ${REPO}"

  jq -n --argjson contexts "$CONTEXTS_JSON" '{
    required_status_checks: {
      strict: true,
      contexts: $contexts
    },
    enforce_admins: true,
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
      required_approving_review_count: 1
    },
    restrictions: null,
    required_conversation_resolution: true
  }' | curl -sS \
    -X PUT \
    -H "Authorization: Bearer ${GH_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "${API}/repos/${REPO}/branches/${BRANCH}/protection" \
    --data-binary @- >/dev/null

  echo "Branch protection applied for ${BRANCH}"
done
