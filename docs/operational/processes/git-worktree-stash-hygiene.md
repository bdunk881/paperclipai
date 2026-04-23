# Git Worktree and Stash Hygiene

## Purpose

Keep local execution workspaces predictable by limiting long-lived worktrees and unowned stash entries.

## Convention

- Keep one primary working tree per active branch owner.
- Use temporary worktrees only for isolated investigations, CI repros, or hotfix validation.
- Name temporary worktrees with ticket identifiers: `alt-<id>-<short-purpose>`.
- Store temporary worktrees under `/private/tmp/` or `./.worktrees/` only.
- Do not leave detached-HEAD worktrees overnight.
- Treat stashes as short-lived handoff buffers, not long-term storage.

## End-Of-Day Cleanup

1. Audit worktrees: `git worktree list`
2. For each temp worktree, either commit/PR the changes or archive a patch and remove the worktree.
3. Audit stashes: `git stash list`
4. For each stash, either apply to an owned branch and commit, or export patch and drop.
5. Validate final state:
   - `git worktree list` should show only active worktrees.
   - `git stash list` should be empty or contain explicitly owned entries with a ticket tag.

## Weekly Sweep Command Set

```bash
git worktree list --porcelain
git stash list
git worktree prune -v
```

## Safety Rule

Before deleting dirty worktrees or clearing stashes, archive recoverable snapshots to a timestamped directory under `/private/tmp/`.
