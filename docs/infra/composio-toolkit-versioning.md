# Composio toolkit/tool versioning policy (P6 / HEL-771)

When to **pin** a Composio tool version vs ride **`latest`**, and how to pin when
you need to.

## The rule

> **Pin** the tool version when **our code parses the tool's output** (we depend
> on a specific response shape). Ride **`latest`** (unpinned) when the output is
> **consumed by an LLM** (the model tolerates schema drift).

Composio evolves tool input/output schemas over time. A version bump can rename
or restructure fields. That breaks code that destructures the response, but an
LLM reading the JSON adapts. So the consumer decides the policy.

## Where each path sits today

| Path | Consumer | Policy | Status |
|---|---|---|---|
| **Engine `composio.execute` step** (`engine/connectorActions/composioActions.ts` → `executeComposioTool`) | the step result `data` flows to downstream steps / templating; **our engine does not hard-parse a versioned field** today — it passes `data` through generically | **unpinned (latest)** is safe **until** a downstream step or our code starts depending on a specific field shape — then pin that tool | unpinned |
| **Agent-runtime native tools** (`agents/composioTools.ts` → `loadComposioAgentTools` → `getRawComposioTools`) | the **LLM** reads the tool result | **`latest`** — never pin (the model tolerates drift; pinning would freeze agents on stale schemas) | unpinned |
| **Triggers** (P4 — `triggers.create` / event payloads) | the wake-engine payload is LLM-/template-consumed | `latest` | unpinned |

**Net: nothing is pinned today** — no path hard-parses a versioned output shape.
That's the correct default. Pin reactively, per-tool, the moment a code-parsed
dependency is introduced.

## How to pin (the mechanism)

`@composio/core@0.10.0` tool params accept an **optional `version: string`** (verified
in the SDK `.d.cts` — it's on the tool execute / fetch param schemas). To pin:

- **Execution**: thread a version into `executeComposioTool` and pass it to
  `composio.tools.execute(slug, { userId, connectedAccountId, arguments, version })`.
  The clean wiring is a `step.config.version` on the `composio.execute` step →
  `executeComposioTool({ …, version })` → the SDK call (a ~1-line passthrough to
  add when the first code-parsed path appears).
- **Tool defs**: pass `version` to `getRawComposioTools({ toolkits, version })` if a
  specific tool-definition revision is ever required (not expected for the
  LLM-consumed runtime).

Record the pinned version + the reason (which code parses it) next to the pin, so
a future reader knows why it's frozen and when it can be revisited.

## Checklist when adding a code-parsed Composio dependency

1. Is our code (not an LLM) reading specific fields from the tool's `data`? If no →
   leave unpinned.
2. If yes → pin the tool version at the call site (`step.config.version` /
   `executeComposioTool({version})`), and add a test asserting the field shape.
3. Note the pin + rationale; schedule a periodic re-check so pins don't rot.
