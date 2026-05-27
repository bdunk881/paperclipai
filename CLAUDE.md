# CLAUDE.md

See [AGENTS.md](AGENTS.md) for the canonical agent operating manual. Anything Claude-Code-specific lives there too.

---

## Linear ticket policy (mandatory for every PR)

Every code change starts in Linear. No untracked PRs.

### One-off PR → one Linear issue

Before touching code or opening a PR, create (or confirm) a Linear issue in the Helloautoflow team. The PR then follows AGENTS.md "Working a single ticket": branch name = Linear's `gitBranchName`, PR title `"<HEL-N> <issue title>"`, body opens with `Closes HEL-N`. Move the issue to `In Progress` at branch time, `Done` on merge.

"One-off" = all of these are true:
- One mergeable PR, no follow-up planned.
- Single concern, reviewable in one pass (rule of thumb: <500 LOC).
- No schema migration another ticket depends on.

If any of those breaks, it's multi-PR work — see below.

### Multi-PR work → Linear project with sub-issues

When a change spans more than one mergeable PR (feature build, multi-step refactor, schema + code + UI rollout), do **not** file a flat list of unparented issues. Instead:

1. Create a Linear **project** under the appropriate phase (P0–P7) with scope and acceptance criteria in the description.
2. File each PR-sized unit of work as a sub-issue attached to that project (via `parent_id` and the project's Issues list).
3. Apply the one-off rules per sub-issue (branch, PR title, `Closes HEL-N`).
4. Never push code against the parent project ticket itself — pick a sub-issue (AGENTS.md "Parent ticket detected").

### Required labels on every issue

Each issue carries a **type label**, an **agent label** (or none if Brad-manual), and a **priority**.

**Type label** (at least one; multiples allowed when honest, e.g. `feature` + `security`):

| Label | Use when |
|---|---|
| `feature` | Net-new capability (customer- or internally-facing) that persists past the PR. |
| `troubleshooting` | Investigating an unclear failure or customer report before the cause is known. Re-label `bug` once a code fix lands. |
| `bug` | Defect with a known cause and a code-level fix. |
| `chore` | Dependency bumps, config tweaks, lint cleanup — no behavior change. |
| `refactor` | Restructuring without behavior change, or paying down explicit tech debt. |
| `docs` | Docs-only edits (`docs/**`, `README.md`, `AGENTS.md`, this file). |
| `security` | authn/authz, secrets, CVEs, tenancy isolation, audit trail. |
| `spike` | Time-boxed research that ships a doc or follow-up ticket, not code. |
| `hotfix` | Production-blocking; combine with `bug` or `security`. File in the same heartbeat as the PR if speed matters, but file it. |

**Agent label**: `agent:claude-routine` / `agent:cursor` / `agent:codex` if an agent will work it. No agent label = Brad's manual work (per AGENTS.md "Routing").

**Priority**: P0–P3. Default P3 if unsure; Brad re-prioritizes.

Don't drop the type label to "skip Linear" — that's the foot-gun this rule closes.

### Approved plans go in the ticket

When the user approves an agent's implementation plan — Claude Code's Plan mode / `ExitPlanMode`, Cursor's plan preview, Codex CLI's plan output, or any other "here's what I'll do" sign-off — the agent posts the **full approved plan, verbatim**, as a comment on the Linear ticket **before writing any code**.

- Verbatim, not summarized. The plan is the contract; future reviewers and other agents read it.
- One comment per approved plan. Plan revisions are new comments, not edits — keep the history.
- If the plan changes scope mid-execution, file a separate ticket per AGENTS.md's "no scope expansion" rule; don't silently rewrite the plan in the existing one.
- Applies to sub-issues too: each sub-issue under a project carries the plan for *its* slice of work.

### AGENTS.md / CLAUDE.md / `docs/` edits

Still need a ticket. Drift in operating manuals is itself a P0 (AGENTS.md "When this file is wrong").
