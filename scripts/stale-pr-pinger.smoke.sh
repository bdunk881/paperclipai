#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TMP_DIR="$(mktemp -d)"
SERVER_LOG="${TMP_DIR}/server.log"
COMMENTS_LOG="${TMP_DIR}/comments.log"
OUTPUT_LOG="${TMP_DIR}/output.log"
SERVER_PORT=32109
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "${TMP_DIR}/bin"

cat > "${TMP_DIR}/bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == "pr" && "$2" == "list" ]]; then
  cat <<'JSON'
[
  {
    "number": 376,
    "title": "Cancelled duplicate should resolve to active sibling",
    "url": "https://github.com/example/repo/pull/376",
    "headRefName": "feat/ALT-2049-controlplane-store-wire",
    "isDraft": false,
    "updatedAt": "2026-04-29T18:30:00Z",
    "statusCheckRollup": [
      {
        "conclusion": "FAILURE",
        "name": "build"
      }
    ],
    "author": {
      "login": "autoflow"
    }
  },
  {
    "number": 377,
    "title": "Cancelled issue without target should skip",
    "url": "https://github.com/example/repo/pull/377",
    "headRefName": "feat/ALT-3000-cancelled-without-target",
    "isDraft": false,
    "updatedAt": "2026-04-29T18:00:00Z",
    "statusCheckRollup": [
      {
        "conclusion": "FAILURE",
        "name": "lint"
      }
    ],
    "author": {
      "login": "autoflow"
    }
  }
]
JSON
  exit 0
fi

echo "Unexpected gh invocation: $*" >&2
exit 1
EOF
chmod +x "${TMP_DIR}/bin/gh"

cat > "${TMP_DIR}/server.js" <<'EOF'
const http = require("http");
const fs = require("fs");
const { URL } = require("url");

const port = Number(process.env.SERVER_PORT);
const commentsLog = process.env.COMMENTS_LOG;

const agents = [
  { id: "agent-active", urlKey: "backend-engineer", name: "Backend Engineer" },
  { id: "routine-agent", urlKey: "devops-engineer", name: "DevOps Engineer" },
];

const issues = {
  "issue-2049": {
    id: "issue-2049",
    identifier: "ALT-2049",
    status: "cancelled",
    parentId: "parent-204x",
    assigneeAgentId: "agent-active",
    blockedBy: [],
    updatedAt: "2026-04-29T18:30:00Z",
  },
  "issue-2048": {
    id: "issue-2048",
    identifier: "ALT-2048",
    status: "blocked",
    parentId: "parent-204x",
    assigneeAgentId: "agent-active",
    blockedBy: [],
    updatedAt: "2026-04-29T18:45:00Z",
  },
  "issue-3000": {
    id: "issue-3000",
    identifier: "ALT-3000",
    status: "done",
    parentId: null,
    assigneeAgentId: "agent-active",
    blockedBy: [],
    updatedAt: "2026-04-29T18:00:00Z",
  },
};

function listIssuesForQuery(url) {
  const q = url.searchParams.get("q");
  const parentId = url.searchParams.get("parentId");
  let results = Object.values(issues);
  if (q) {
    results = results.filter((issue) => issue.identifier.includes(q));
  }
  if (parentId) {
    results = results.filter((issue) => issue.parentId === parentId);
  }
  return results;
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);

  if (req.method === "GET" && url.pathname === "/api/companies/test-company/agents") {
    sendJson(res, 200, agents);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/companies/test-company/issues") {
    sendJson(res, 200, listIssuesForQuery(url));
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/issues/") && url.pathname.endsWith("/comments")) {
    sendJson(res, 200, []);
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/issues/") && url.pathname.endsWith("/comments")) {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      fs.appendFileSync(commentsLog, JSON.stringify({ path: url.pathname, body: JSON.parse(body) }) + "\n");
      sendJson(res, 200, { ok: true });
    });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/issues/")) {
    const issueId = url.pathname.split("/")[3];
    const issue = issues[issueId];
    if (!issue) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    sendJson(res, 200, issue);
    return;
  }

  sendJson(res, 404, { error: "unhandled", method: req.method, path: url.pathname });
});

server.listen(port, "127.0.0.1", () => {
  fs.writeFileSync(process.stdout.fd, "server-ready\n");
});
EOF

PATH="${TMP_DIR}/bin:${PATH}" \
COMMENTS_LOG="$COMMENTS_LOG" \
SERVER_PORT="$SERVER_PORT" \
node "${TMP_DIR}/server.js" >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 50); do
  if grep -q "server-ready" "$SERVER_LOG" 2>/dev/null; then
    break
  fi
  sleep 0.1
done

if ! grep -q "server-ready" "$SERVER_LOG" 2>/dev/null; then
  echo "Mock server failed to start" >&2
  cat "$SERVER_LOG" >&2 || true
  exit 1
fi

PATH="${TMP_DIR}/bin:${PATH}" \
PAPERCLIP_API_URL="http://127.0.0.1:${SERVER_PORT}" \
PAPERCLIP_COMPANY_ID="test-company" \
PAPERCLIP_API_KEY="test-token" \
PAPERCLIP_RUN_ID="test-run" \
PAPERCLIP_AGENT_ID="routine-agent" \
"${REPO_ROOT}/scripts/stale-pr-pinger.sh" 2>&1 | tee "$OUTPUT_LOG"

if ! grep -q "Resolved linked issue ALT-2049 (cancelled) -> ALT-2048 (blocked) via parentId sibling heuristic" "$OUTPUT_LOG"; then
  echo "Expected duplicate-resolution log line was not emitted" >&2
  exit 1
fi

if ! grep -q "Skipping PR #377 for ALT-3000: linked issue status=done and no active duplicate target was found" "$OUTPUT_LOG"; then
  echo "Expected cancelled/done skip log line was not emitted" >&2
  exit 1
fi

if ! grep -q "/api/issues/issue-2048/comments" "$COMMENTS_LOG"; then
  echo "Expected comment to be posted to the resolved active issue" >&2
  exit 1
fi

if grep -q "/api/issues/issue-2049/comments" "$COMMENTS_LOG"; then
  echo "Comment was incorrectly posted to the closed duplicate issue" >&2
  exit 1
fi

comment_count="$(wc -l < "$COMMENTS_LOG" | tr -d ' ')"
if [[ "$comment_count" != "1" ]]; then
  echo "Expected exactly one posted comment, saw $comment_count" >&2
  exit 1
fi

echo "stale-pr-pinger smoke test passed"
