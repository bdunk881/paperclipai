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
REQUIRED_CHECKS="${REQUIRED_CHECKS:-Docker Build Check}"
MASTER_ALLOWED_USERS="${MASTER_ALLOWED_USERS:-bdunk881}"
STAGING_ALLOWED_USERS="${STAGING_ALLOWED_USERS:-bdunk881}"
MASTER_ALLOWED_TEAMS="${MASTER_ALLOWED_TEAMS:-}"
STAGING_ALLOWED_TEAMS="${STAGING_ALLOWED_TEAMS:-}"
MASTER_ALLOWED_APPS="${MASTER_ALLOWED_APPS:-}"
STAGING_ALLOWED_APPS="${STAGING_ALLOWED_APPS:-}"

IFS=',' read -r -a CHECK_CONTEXTS <<<"$REQUIRED_CHECKS"
for i in "${!CHECK_CONTEXTS[@]}"; do
  CHECK_CONTEXTS[$i]="$(echo "${CHECK_CONTEXTS[$i]}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
done

CONTEXTS_JSON="$(printf '%s\n' "${CHECK_CONTEXTS[@]}" | jq -R . | jq -s .)"

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
      USERS_JSON="$(csv_to_json "$MASTER_ALLOWED_USERS")"
      TEAMS_JSON="$(csv_to_json "$MASTER_ALLOWED_TEAMS")"
      APPS_JSON="$(csv_to_json "$MASTER_ALLOWED_APPS")"
      ;;
    staging)
      USERS_JSON="$(csv_to_json "$STAGING_ALLOWED_USERS")"
      TEAMS_JSON="$(csv_to_json "$STAGING_ALLOWED_TEAMS")"
      APPS_JSON="$(csv_to_json "$STAGING_ALLOWED_APPS")"
      ;;
    *)
      USERS_JSON='[]'
      TEAMS_JSON='[]'
      APPS_JSON='[]'
      ;;
  esac

  jq -n \
    --argjson contexts "$CONTEXTS_JSON" \
    --argjson users "$USERS_JSON" \
    --argjson teams "$TEAMS_JSON" \
    --argjson apps "$APPS_JSON" '{
    required_status_checks: {
      strict: true,
      contexts: $contexts
    },
    enforce_admins: true,
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
      required_approving_review_count: 1,
      require_last_push_approval: false,
      bypass_pull_request_allowances: {
        users: $users,
        teams: $teams,
        apps: $apps
      }
    },
    restrictions: {
      users: $users,
      teams: $teams,
      apps: $apps
    },
    allow_force_pushes: {
      enabled: false
    },
    allow_deletions: {
      enabled: false
    },
    block_creations: true,
    required_linear_history: false,
    allow_fork_syncing: false,
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
