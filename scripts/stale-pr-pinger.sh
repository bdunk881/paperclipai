#!/usr/bin/env bash
set -euo pipefail

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd gh
require_cmd jq
require_cmd node
require_cmd python3

API_URL="${PAPERCLIP_API_URL:-${PAPERCLIP_API_BASE_URL:-}}"
COMPANY_ID="${PAPERCLIP_COMPANY_ID:-}"
RUN_ID="${PAPERCLIP_RUN_ID:-stale-pr-pinger-$(uuidgen | tr '[:upper:]' '[:lower:]')}"
STALE_MINUTES="${STALE_PR_MINUTES:-30}"
COMMENTER_AGENT_ID="${ROUTINE_COMMENTER_AGENT_ID:-${PAPERCLIP_AGENT_ID:-}}"
COMMENTER_ADAPTER_TYPE="${ROUTINE_COMMENTER_ADAPTER_TYPE:-${PAPERCLIP_AGENT_ADAPTER_TYPE:-claude_local}}"
AUTH_TOKEN="${PAPERCLIP_API_KEY:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -z "$API_URL" ]]; then
  echo "PAPERCLIP_API_URL or PAPERCLIP_API_BASE_URL is required" >&2
  exit 1
fi

if [[ -z "$COMPANY_ID" ]]; then
  echo "PAPERCLIP_COMPANY_ID is required" >&2
  exit 1
fi

if [[ -z "$AUTH_TOKEN" ]]; then
  if [[ -z "$COMMENTER_AGENT_ID" || -z "${PAPERCLIP_AGENT_JWT_SECRET:-}" ]]; then
    echo "PAPERCLIP_API_KEY is required unless PAPERCLIP_AGENT_JWT_SECRET and a commenter agent id are available" >&2
    exit 1
  fi

  AUTH_TOKEN="$(
    PAPERCLIP_SIGNING_AGENT_ID="$COMMENTER_AGENT_ID" \
    PAPERCLIP_SIGNING_COMPANY_ID="$COMPANY_ID" \
    PAPERCLIP_SIGNING_ADAPTER_TYPE="$COMMENTER_ADAPTER_TYPE" \
    PAPERCLIP_SIGNING_RUN_ID="$RUN_ID" \
    PAPERCLIP_SIGNING_SECRET="$PAPERCLIP_AGENT_JWT_SECRET" \
    node <<'NODE'
const jwt = require("jsonwebtoken");

const now = Math.floor(Date.now() / 1000);
process.stdout.write(
  jwt.sign(
    {
      sub: process.env.PAPERCLIP_SIGNING_AGENT_ID,
      company_id: process.env.PAPERCLIP_SIGNING_COMPANY_ID,
      adapter_type: process.env.PAPERCLIP_SIGNING_ADAPTER_TYPE,
      run_id: process.env.PAPERCLIP_SIGNING_RUN_ID,
      iat: now,
      exp: now + 60 * 60,
      iss: "paperclip",
      aud: "paperclip-api",
    },
    process.env.PAPERCLIP_SIGNING_SECRET,
    { algorithm: "HS256" }
  )
);
NODE
  )"
fi

if [[ -z "$COMMENTER_AGENT_ID" ]]; then
  COMMENTER_AGENT_ID="$(
    node -e '
      const token = process.argv[1];
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
      process.stdout.write(String(payload.sub || ""));
    ' "$AUTH_TOKEN"
  )"
fi

api_get() {
  local path="$1"
  curl -fsS \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    "${API_URL}${path}"
}

api_get_with_query() {
  local path="$1"
  local key="$2"
  local value="$3"
  curl -fsS \
    -G \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    --data-urlencode "${key}=${value}" \
    "${API_URL}${path}"
}

api_post() {
  local path="$1"
  local body="$2"
  curl -fsS \
    -X POST \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -H "X-Paperclip-Run-Id: $RUN_ID" \
    --data "$body" \
    "${API_URL}${path}"
}

is_terminal_issue_status() {
  local status="$1"
  [[ "$status" == "cancelled" || "$status" == "done" ]]
}

get_issue_by_identifier() {
  local identifier="$1"
  local issue_matches
  local issue_json
  local issue_id

  issue_matches="$(api_get_with_query "/api/companies/${COMPANY_ID}/issues" "q" "$identifier")"
  issue_json="$(jq -c --arg identifier "$identifier" 'map(select(.identifier == $identifier)) | first // empty' <<<"$issue_matches")"
  if [[ -z "$issue_json" ]]; then
    return 1
  fi

  issue_id="$(jq -r '.id' <<<"$issue_json")"
  api_get "/api/issues/${issue_id}"
}

find_replacement_issue() {
  local issue_json="$1"
  local parent_id
  local self_id
  local blocked_by_candidate
  local sibling_matches
  local sibling_candidate

  blocked_by_candidate="$(
    jq -c '
      [.blockedBy[]? | select((.status // "") != "cancelled" and (.status // "") != "done")]
      | sort_by(.updatedAt // "")
      | reverse
      | first // empty
    ' <<<"$issue_json"
  )"
  if [[ -n "$blocked_by_candidate" ]]; then
    jq -cn --arg source "blockedBy" --argjson issue "$blocked_by_candidate" '{source: $source, issue: $issue}'
    return 0
  fi

  parent_id="$(jq -r '.parentId // empty' <<<"$issue_json")"
  if [[ -z "$parent_id" ]]; then
    return 1
  fi

  self_id="$(jq -r '.id' <<<"$issue_json")"
  sibling_matches="$(api_get_with_query "/api/companies/${COMPANY_ID}/issues" "parentId" "$parent_id")"
  sibling_candidate="$(
    jq -c --arg self_id "$self_id" '
      map(select(.id != $self_id and (.status // "") != "cancelled" and (.status // "") != "done"))
      | sort_by(.updatedAt // "")
      | reverse
      | first // empty
    ' <<<"$sibling_matches"
  )"
  if [[ -n "$sibling_candidate" ]]; then
    jq -cn --arg source "parentId sibling" --argjson issue "$sibling_candidate" '{source: $source, issue: $issue}'
    return 0
  fi

  return 1
}

resolve_linked_issue() {
  local issue_json="$1"
  local pr_number="$2"
  local depth=0
  local max_depth=5
  local identifier
  local status
  local replacement_json
  local replacement_issue
  local replacement_source
  local replacement_identifier
  local replacement_status

  while (( depth < max_depth )); do
    identifier="$(jq -r '.identifier' <<<"$issue_json")"
    status="$(jq -r '.status // empty' <<<"$issue_json")"
    if ! is_terminal_issue_status "$status"; then
      printf '%s\n' "$issue_json"
      return 0
    fi

    # Closed branch-linked issues may be duplicate shells. Prefer an active
    # blockedBy target first, then an active sibling under the same parent.
    if ! replacement_json="$(find_replacement_issue "$issue_json")"; then
      printf 'Skipping PR #%s for %s: linked issue status=%s and no active duplicate target was found\n' \
        "$pr_number" \
        "$identifier" \
        "$status" >&2
      return 1
    fi

    replacement_source="$(jq -r '.source' <<<"$replacement_json")"
    replacement_issue="$(jq -c '.issue' <<<"$replacement_json")"
    replacement_identifier="$(jq -r '.identifier' <<<"$replacement_issue")"
    replacement_status="$(jq -r '.status // empty' <<<"$replacement_issue")"

    printf 'Resolved linked issue %s (%s) -> %s (%s) via %s heuristic\n' \
      "$identifier" \
      "$status" \
      "$replacement_identifier" \
      "$replacement_status" \
      "$replacement_source" >&2

    issue_json="$replacement_issue"
    depth=$((depth + 1))
  done

  printf 'Skipping PR #%s: exceeded duplicate-resolution depth for linked issue %s\n' \
    "$pr_number" \
    "$(jq -r '.identifier' <<<"$issue_json")" >&2
  return 1
}

is_stale_pr() {
  local updated_at="$1"
  python3 - "$updated_at" "$STALE_MINUTES" <<'PY'
from datetime import datetime, timezone
import sys

updated_at = sys.argv[1]
threshold_minutes = int(sys.argv[2])
updated = datetime.strptime(updated_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
delta_seconds = (datetime.now(timezone.utc) - updated).total_seconds()
print("true" if delta_seconds >= threshold_minutes * 60 else "false")
PY
}

cd "$REPO_ROOT"

agents_json="$(api_get "/api/companies/${COMPANY_ID}/agents")"
prs_json="$(gh pr list --state open --limit 100 --json number,title,url,headRefName,isDraft,updatedAt,statusCheckRollup,author)"

posted_count=0
skipped_count=0
candidate_count=0

while IFS= read -r pr; do
  is_draft="$(jq -r '.isDraft' <<<"$pr")"
  if [[ "$is_draft" == "true" ]]; then
    skipped_count=$((skipped_count + 1))
    continue
  fi

  updated_at="$(jq -r '.updatedAt' <<<"$pr")"
  if [[ "$(is_stale_pr "$updated_at")" != "true" ]]; then
    skipped_count=$((skipped_count + 1))
    continue
  fi

  failed_checks="$(jq -r '[.statusCheckRollup[]? | select(.conclusion == "FAILURE") | (.name // .context // "unknown")] | unique | join(", ")' <<<"$pr")"
  if [[ -z "$failed_checks" ]]; then
    skipped_count=$((skipped_count + 1))
    continue
  fi

  branch_name="$(jq -r '.headRefName' <<<"$pr")"
  issue_identifier="$(grep -Eo 'ALT-[0-9]+' <<<"$branch_name" | head -n 1 || true)"
  if [[ -z "$issue_identifier" ]]; then
    skipped_count=$((skipped_count + 1))
    continue
  fi

  if ! issue_json="$(get_issue_by_identifier "$issue_identifier")"; then
    skipped_count=$((skipped_count + 1))
    continue
  fi

  pr_number="$(jq -r '.number' <<<"$pr")"
  if ! issue_json="$(resolve_linked_issue "$issue_json" "$pr_number")"; then
    skipped_count=$((skipped_count + 1))
    continue
  fi

  issue_id="$(jq -r '.id' <<<"$issue_json")"
  issue_identifier="$(jq -r '.identifier' <<<"$issue_json")"
  assignee_agent_id="$(jq -r '.assigneeAgentId // empty' <<<"$issue_json")"
  if [[ -z "$assignee_agent_id" ]]; then
    skipped_count=$((skipped_count + 1))
    continue
  fi

  mention_target="$(jq -r --arg agent_id "$assignee_agent_id" 'map(select(.id == $agent_id)) | first | (.urlKey // .name // empty)' <<<"$agents_json")"
  if [[ -z "$mention_target" ]]; then
    skipped_count=$((skipped_count + 1))
    continue
  fi

  latest_comment_json="$(api_get "/api/issues/${issue_id}/comments?order=desc&limit=1")"
  latest_author_agent_id="$(jq -r '.[0].authorAgentId // empty' <<<"$latest_comment_json")"
  latest_body="$(jq -r '.[0].body // empty' <<<"$latest_comment_json")"

  if [[ "$latest_author_agent_id" == "$COMMENTER_AGENT_ID" && "$latest_body" == *"PR #${pr_number}"* && "$latest_body" == *"CI is failing"* ]]; then
    skipped_count=$((skipped_count + 1))
    continue
  fi

  candidate_count=$((candidate_count + 1))

  pr_url="$(jq -r '.url' <<<"$pr")"
  comment_body="$(
    printf '@%s CI is failing on [PR #%s](%s).\n- Failed checks: %s\n- Last activity: %s\nPlease address or mark blocked.' \
      "$mention_target" \
      "$pr_number" \
      "$pr_url" \
      "$failed_checks" \
      "$updated_at"
  )"

  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    printf 'DRY RUN: would comment on %s (%s) for PR #%s\n%s\n\n' \
      "$issue_identifier" \
      "$issue_id" \
      "$pr_number" \
      "$comment_body"
    continue
  fi

  api_post "/api/issues/${issue_id}/comments" "$(jq -n --arg body "$comment_body" '{body: $body}')" >/dev/null
  posted_count=$((posted_count + 1))
  printf 'Posted stale CI ping for %s via PR #%s\n' "$issue_identifier" "$pr_number"
done < <(jq -c '.[]' <<<"$prs_json")

printf 'stale-pr-pinger summary: candidates=%s posted=%s skipped=%s\n' "$candidate_count" "$posted_count" "$skipped_count"
