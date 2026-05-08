# AGENTS

## Routing

All automation and agent work should be routed by **Linear labels** (not `assignee=me`, since multiple agents share the same human assignee identity).

- `agent:claude-routine` — tickets for the hourly cloud Claude routine.
- `agent:cursor` — tickets Brad routes to Cursor in IDE.
- `agent:codex` — tickets Brad routes to Codex CLI.
- _No label_ — tickets Brad handles manually.

## Linear query rules

- **Claude cloud routine pull query**: filter to `team=Helloautoflow`, `assignee=me`, `state='In Progress'`, and `label='agent:claude-routine'`.
- If no matching ticket exists, exit cleanly.
- **Auto-promote query**: only consider Backlog/Todo tickets in the same phase project that also include `label='agent:claude-routine'`, then pick the top qualifying ticket by priority and move it to In Progress.

## Other agents

- Cursor sessions should only pull tickets labeled `agent:cursor`.
- Codex sessions should only pull tickets labeled `agent:codex`.
