# Agent handoff protocol

> Brad's working doc for routing Linear tickets to the right agent (Claude Code routine, Cursor, Codex) — and the handoff rhythm. Refine to taste over time.

This file complements [`AGENTS.md`](../AGENTS.md). `AGENTS.md` describes how each agent operates; this doc is the operator-side decision guide.

## Which agent gets which ticket

| Ticket shape | Best fit | Why |
|---|---|---|
| Multi-file refactor with deep code grep | **Claude Code routine** (cloud) | Long sessions, full repo context, runs tests, opens its own PRs. Picks up automatically on the hourly cron when delegated. |
| Big migrations / system-wide schema work | **Claude Code routine** | Same — tolerates iteration and waits for CI. |
| In-IDE iterative work where you want to drive | **Cursor** | Fast inner loop, you steer in real time, good for design polish or single-purpose changes you want to feel out as they go. |
| Self-contained CLI scripts, ad-hoc one-shots, multi-package config edits | **Codex CLI** | Lightweight, runs in your terminal, low overhead per pickup. Great for shell work and small modules. |
| Docs / playbook / planning content | **Claude Code (this CLI session)** when you're already in conversation, otherwise the routine | The agent that has the most recent context wins. |
| Anything destructive (DB migration cutover, secret rotation, data deletion, mass file delete) | **Brad himself** | Higher stakes than agent latitude allows. |
| Anything touching branch protection or repo settings | **Brad himself** | Hard "never" on the agent operating list. |
| Anything customer-impacting on the live deployment | **Brad himself** | Same — dry-run-only for agents. |

## Routing mechanism

Linear's native **`delegate`** field is the primitive — not labels (the labels approach was filed under HEL-50 but `delegate` is simpler and built-in).

| Delegate value | Picked up by |
|---|---|
| `Claude` | Cloud routine on hourly cron |
| `Cursor` | You opening Cursor and prompting it with the issue ID |
| `Codex` | You opening Codex CLI and prompting it with the issue ID |
| (no delegate) | Brad does it himself |

The `assignee` field stays on Brad for everything — agents share Brad's Linear identity. `delegate` is the disambiguator.

## Assignment workflow

1. Open the Linear ticket.
2. Decide which agent (or yourself) per the table above.
3. Set the `delegate` field accordingly.
4. Move the ticket to **In Progress** when ready for the agent to pick up.
5. For the cloud routine: it picks up on the next hourly fire (≤60 min latency).
6. For Cursor / Codex: you open the IDE/CLI and feed them the issue ID + a "go work this" prompt.
7. Watch the comments + PR; review when the agent flags it ready.

## The handoff loop

Every agent follows the same protocol from `AGENTS.md`:

1. Move ticket to **In Progress**, comment a kickoff note.
2. Branch from `dev` using Linear's `gitBranchName`.
3. Do the work. Don't add scope.
4. Open a PR into `dev` with `Closes HEL-N`.
5. Comment the PR URL on the Linear ticket.
6. Once CI is green and the PR merges, Linear auto-closes the ticket.
7. **Auto-promote:** the agent picks the highest-priority `Todo` ticket in the same phase project (with `delegate` matching itself, `blockedBy` satisfied) and starts it on the next run.

## Stop conditions

If an agent labels a ticket `ci-failure` or `needs-human` and stops, it means:

- **`ci-failure`** — 3 consecutive CI failures, agent gave up. Triage: are the failures real, are they pre-existing (HEL-47 territory), is the spec wrong? Decide whether to re-delegate, fix the spec, or take it yourself.
- **`needs-human`** — spec ambiguity the agent couldn't resolve. Read the question in the comments, answer, optionally update the ticket description, then move back to In Progress.

## Switching agents mid-flight

If Cursor gets stuck on a ticket and you want the routine to take over:

1. Close Cursor's PR (or leave it open for reference).
2. Comment the diagnosis on the Linear ticket.
3. Change `delegate` from `Cursor` to `Claude`.
4. The routine picks it up next fire.

Same direction in reverse if the routine is grinding and you want to drive it manually in Cursor.

## Conflict avoidance

Two agents accidentally pick up the same ticket:

- **Should be prevented** by the delegate filter — each agent only picks tickets matching its own delegate.
- **If it happens anyway** (e.g., Cursor and Codex both prompted on the same ticket), whichever opens a PR first wins. The other should detect the existing PR per `AGENTS.md` step 3a and stop.

## When to do it yourself

The temptation is to delegate everything. Don't. Some categories where you're the right answer:

- **Branch protection settings** — `gh api PUT branches/.../protection` is a Brad-only action per `AGENTS.md`.
- **Secret rotation in live providers** — too many side effects to delegate.
- **DNS / live-traffic cutovers** — same.
- **DB migration application against production** — same. (Designing a migration is delegate-able; running it isn't.)
- **First-time customer triage** — you'll learn things from the first 10 paying customers that no agent can.
- **Anything that needs a human-judgment call about the *product*** — agents are good at *executing* a clear spec, not deciding *what* to build.

## How this file evolves

Update this doc whenever the heuristics shift. The most important property is that *future-you* (or another founder) reading it cold can route tickets correctly.

Drift in this file is itself a P0 — it leads operators astray and the cost compounds.
