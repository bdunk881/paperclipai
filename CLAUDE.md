# CLAUDE.md

See [AGENTS.md](AGENTS.md) for the canonical agent operating manual. Anything Claude-Code-specific lives there too.

---

## ⛔ Branch & PR target — `dev` ONLY (non-negotiable)

**Every branch is cut from `dev`, and every pull request targets `dev`.** Never
open, retarget, or push a PR against `main` or `master` — those are the frozen
production line and are gated separately ([HEL-7](https://linear.app/helloautoflow/issue/HEL-7)).

Do this every time, no exceptions:
1. Before branching: `git checkout dev && git pull origin dev`, then branch off it.
2. When opening a PR, set the **base to `dev`** explicitly (`gh pr create --base dev …`,
   or `base: "dev"` on the GitHub MCP `create_pull_request` call). Do not rely on the
   repo default base — it may be `main`/`master`.
3. **After opening, verify the base is `dev`.** If a PR ever shows `main`/`master`
   as its base (telltale sign: a diff of hundreds/thousands of files), retarget it to
   `dev` immediately (`gh pr edit <n> --base dev` or MCP `update_pull_request`).

Promotion `dev → staging → master` is a separate, human-gated step (see AGENTS.md
"Branch flow"). Agents never promote to `master`.

---

## Dynamic workflows — when to use them (mandatory)

[Dynamic workflows](https://code.claude.com/docs/en/workflows) are a Claude Code
feature (research preview — needs v2.1.154+; enable via the **Dynamic workflows**
row in `/config`). A workflow is a **script Claude writes that orchestrates many
subagents** — dozens to hundreds — running in the background while your session
stays responsive. The plan lives in the *script*, not the chat, so intermediate
results stay in script variables and only the **final result** lands in your
context. That's the point: a workflow keeps the main session clean on work too big
for one conversation to coordinate, and codifies the orchestration so it's
rerunnable.

This is distinct from a single **subagent** or a **skill**, where Claude holds the
plan turn by turn and every result lands in context. Use a *workflow* — not an
ad-hoc subagent — for the two cases below.

**Always run as a dynamic workflow:**

- **Code review.** Run review as a workflow so it applies a repeatable, adversarial
  pattern — independent agents cross-checking each other's findings — instead of a
  single eyeball pass, and **save it** so the same review runs on every branch.
  Save to `.claude/workflows/` (shared in the repo) so every agent and human reviews
  the same way; invoke a saved one as `/<name>`, or kick a one-off with
  `ultracode: review this diff for correctness + tenancy bugs`.
- **Large work sessions / codebase sweeps.** Whole-repo greps, audits, and
  migrations — "audit every endpoint under `src/routes/` for missing auth checks," a
  500-file rename, "where is X wired across the whole codebase." Trigger with the
  `ultracode` keyword (or just ask "use a workflow"); the script fans the work across
  many agents and returns the *conclusion*, not 40 inline greps that bury the session.

**Also reach for a workflow for:**

- **Cross-checked research** — the bundled `/deep-research <question>` workflow: fans
  web searches across angles, cross-checks sources, returns a cited report (library
  choices, external API behavior, post-cutoff facts).
- **A hard plan worth several angles** — have a workflow draft the plan from
  independent angles and weigh them before you commit (then post the approved plan to
  the Linear ticket, per "Approved plans go in the ticket" below).
- **Anything needing more agents than one conversation can coordinate**, or that you
  want codified as a rerunnable script.

How to drive them: `ultracode: <task>` (or "use a workflow") starts one for a single
task; `/effort ultracode` lets Claude pick a workflow for every substantive task in
the session; `/workflows` lists runs to watch, pause, or **save** (`s`) as a reusable
command. Workflows are gated by an approval prompt before they run — review the
planned phases, then approve. Reserve plain subagents and skills (`/verify`, `/run`,
`/simplify`, the **Plan** subagent) for smaller, one-shot delegations that fit a
single turn.

---

## Linear ticket policy (mandatory for every PR)

Every code change starts in Linear. No untracked PRs.

### One-off PR → one Linear issue

Before touching code or opening a PR, create (or confirm) a Linear issue in the Helloautoflow team. The PR then follows AGENTS.md "Working a single ticket": branch name = Linear's `gitBranchName`, PR title `"<HEL-N> <issue title>"`, body opens with `Closes HEL-N`. Walk the issue through the status lifecycle below: `In Progress` when you pick up the work, `In Review` when the PR is open, `Done` on merge.

### Status lifecycle (the Linear workflow states)

Move every issue through these states honestly — the board is how Brad and the other agents see what's happening without reading chat.

| State | When it applies |
|---|---|
| **Triage** | Error-handling inbox: incoming Sentry alerts, prod/CI failures, and customer bug reports land here *before* they're understood or assigned. Sort each one into `Backlog` (with a type label + priority) or `Canceled`. Nothing stays in Triage. |
| **Backlog** | Filed and accepted, but **not started**. The default home for new work that isn't queued for pickup yet. |
| **Todo** | Queued and ready — next up for pickup (optional staging lane; the Claude routine may auto-promote from here). |
| **In Progress** | An agent (or human) has **picked up the work** and is actively building. Move here the moment you branch off `dev`. |
| **In Review** | The **PR is open and waiting for review/merge**. Move here when you push the PR — not before, not at merge. |
| **Done** | The **PR has merged**. Only after merge — never on PR-open. |
| **Canceled** | Won't-do, obsolete, or superseded — including **duplicates**. (Linear also has a dedicated **Duplicate** state; use it when an issue literally duplicates another and link the original.) |

Never skip `In Review`: a merged-but-never-reviewed jump from `In Progress` straight to `Done` hides the review gate.

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
