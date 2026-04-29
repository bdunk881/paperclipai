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
TARGET_BRANCHES=("staging" "master")
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REQUIRED_CHECKS_FILE="${SCRIPT_DIR}/../branch-protection/required-checks.json"

if [ ! -f "$REQUIRED_CHECKS_FILE" ]; then
  echo "Missing required checks file: ${REQUIRED_CHECKS_FILE}"
  exit 1
fi

load_required_checks() {
  local branch="$1"
  jq -r --arg branch "$branch" '.[$branch] | join(",")' "$REQUIRED_CHECKS_FILE"
}

STAGING_REQUIRED_CHECKS="${STAGING_REQUIRED_CHECKS:-$(load_required_checks staging)}"
MASTER_REQUIRED_CHECKS="${MASTER_REQUIRED_CHECKS:-$(load_required_checks master)}"
MASTER_ALLOWED_USERS="${MASTER_ALLOWED_USERS:-bdunk881}"
STAGING_ALLOWED_USERS="${STAGING_ALLOWED_USERS:-bdunk881}"
MASTER_ALLOWED_TEAMS="${MASTER_ALLOWED_TEAMS:-}"
STAGING_ALLOWED_TEAMS="${STAGING_ALLOWED_TEAMS:-}"
MASTER_ALLOWED_APPS="${MASTER_ALLOWED_APPS:-}"
STAGING_ALLOWED_APPS="${STAGING_ALLOWED_APPS:-}"

REPO_RESPONSE_FILE="$(mktemp)"
REPO_STATUS_CODE="$(curl -sS -o "$REPO_RESPONSE_FILE" -w "%{http_code}" \
  -X GET \
  -H "Authorization: Bearer ${GH_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "${API}/repos/${REPO}")"

if [ "$REPO_STATUS_CODE" != "200" ]; then
  echo "Unable to read repository metadata for ${REPO} (status ${REPO_STATUS_CODE})"
  cat "$REPO_RESPONSE_FILE"
  rm -f "$REPO_RESPONSE_FILE"
  exit 1
fi

REPO_OWNER_TYPE="$(jq -r '.owner.type' "$REPO_RESPONSE_FILE")"
rm -f "$REPO_RESPONSE_FILE"

csv_to_json() {
  local value="$1"

  if [ -z "$value" ]; then
    printf '[]'
    return
  fi

  printf '%s\n' "$value" \
    | tr ',' '\n' \
    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' \
    | sed '/^$/d' \
    | jq -R . \
    | jq -s .
}

checks_to_json() {
  local value="$1"

  printf '%s\n' "$value" \
    | tr ',' '\n' \
    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' \
    | sed '/^$/d' \
    | jq -R . \
    | jq -s .
}

verify_protection_response() {
  local response_file="$1"
  local contexts_json="$2"
  local require_codeowner_reviews="$3"

  jq -e \
    --argjson contexts "$contexts_json" \
    --argjson requireCodeOwnerReviews "$require_codeowner_reviews" '
      ((.required_status_checks.contexts // []) | sort) == ($contexts | sort) and
      .required_pull_request_reviews.required_approving_review_count == 1 and
      .required_pull_request_reviews.require_code_owner_reviews == $requireCodeOwnerReviews and
      .required_conversation_resolution.enabled == true and
      .enforce_admins.enabled == true
    ' "$response_file" >/dev/null
}

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

  case "$BRANCH" in
    master)
      CONTEXTS_JSON="$(checks_to_json "$MASTER_REQUIRED_CHECKS")"
      USERS_JSON="$(csv_to_json "$MASTER_ALLOWED_USERS")"
      TEAMS_JSON="$(csv_to_json "$MASTER_ALLOWED_TEAMS")"
      APPS_JSON="$(csv_to_json "$MASTER_ALLOWED_APPS")"
      REQUIRE_CODEOWNER_REVIEWS='true'
      ;;
    staging)
      CONTEXTS_JSON="$(checks_to_json "$STAGING_REQUIRED_CHECKS")"
      USERS_JSON="$(csv_to_json "$STAGING_ALLOWED_USERS")"
      TEAMS_JSON="$(csv_to_json "$STAGING_ALLOWED_TEAMS")"
      APPS_JSON="$(csv_to_json "$STAGING_ALLOWED_APPS")"
      REQUIRE_CODEOWNER_REVIEWS='false'
      ;;
    *)
      CONTEXTS_JSON='[]'
      USERS_JSON='[]'
      TEAMS_JSON='[]'
      APPS_JSON='[]'
      REQUIRE_CODEOWNER_REVIEWS='false'
      ;;
  esac

  if [ "$REPO_OWNER_TYPE" = "Organization" ] && \
     { [ "$USERS_JSON" != '[]' ] || [ "$TEAMS_JSON" != '[]' ] || [ "$APPS_JSON" != '[]' ]; }; then
    RESTRICTIONS_JSON="$(jq -n \
      --argjson users "$USERS_JSON" \
      --argjson teams "$TEAMS_JSON" \
      --argjson apps "$APPS_JSON" \
      '{users: $users, teams: $teams, apps: $apps}')"
  else
    RESTRICTIONS_JSON='null'
  fi

  RESPONSE_FILE="$(mktemp)"

  jq -n \
    --argjson contexts "$CONTEXTS_JSON" \
    --argjson restrictions "$RESTRICTIONS_JSON" \
    --argjson requireCodeOwnerReviews "$REQUIRE_CODEOWNER_REVIEWS" '{
    required_status_checks: {
      strict: true,
      contexts: $contexts
    },
    enforce_admins: true,
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: $requireCodeOwnerReviews,
      required_approving_review_count: 1,
      require_last_push_approval: false
    },
    restrictions: $restrictions,
    allow_force_pushes: false,
    allow_deletions: false,
    required_linear_history: false,
    allow_fork_syncing: false,
    required_conversation_resolution: true
  }' | curl -sS \
    -X PUT \
    -H "Authorization: Bearer ${GH_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "${API}/repos/${REPO}/branches/${BRANCH}/protection" \
    --data-binary @- \
    -o "$RESPONSE_FILE" \
    -w "%{http_code}" >"${RESPONSE_FILE}.status"

  STATUS_CODE="$(cat "${RESPONSE_FILE}.status")"
  rm -f "${RESPONSE_FILE}.status"

  if [ "$STATUS_CODE" != "200" ]; then
    echo "Failed to apply branch protection for ${BRANCH} (status ${STATUS_CODE})"
    cat "$RESPONSE_FILE"
    rm -f "$RESPONSE_FILE"
    exit 1
  fi

  if ! verify_protection_response "$RESPONSE_FILE" "$CONTEXTS_JSON" "$REQUIRE_CODEOWNER_REVIEWS"; then
    echo "Branch protection response for ${BRANCH} did not match the expected settings"
    cat "$RESPONSE_FILE"
    rm -f "$RESPONSE_FILE"
    exit 1
  fi

  rm -f "$RESPONSE_FILE"

  echo "Branch protection applied for ${BRANCH}"
done
