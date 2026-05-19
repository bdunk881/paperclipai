# Product LLM token-cost audit

**Date:** 2026-05-18
**Scope:** Anthropic API spend inside the AutoFlow product (not Claude
Code session tokens). Spun off the DASH-64 audit when the question
"can we reduce LLM costs" landed.

## TL;DR

Four findings, ordered by impact:

| # | Finding | Impact | Ticket |
|---|---------|--------|--------|
| 1 | **Zero prompt caching in production code.** Adapter reads `cache_read_input_tokens` from responses but never sets `cache_control: ephemeral` on requests. | **Highest** — 50–80% input-token reduction on hot paths once enabled | HEL-145 |
| 2 | `agentCheckIn` calls Sonnet for a 240-char one-line status pill. Should be Haiku. | High frequency × wrong tier = persistent waste | HEL-146 |
| 3 | Every Anthropic call uses `max_tokens: 4096` regardless of expected output size. Triage decisions, classifier enums, and status pills all share the same cap. | Medium — affects model "fill the budget" behavior more than billing | HEL-147 |
| 4 | When the LLM-backed triage invoker lands (currently stub returns rule-based decisions), the agent identity card + triage policy body are stable per agent and MUST be cached. | High — triage runs on every wake event; identity card is ~500–1500 tokens of stable prefix | HEL-148 |

## Detail

### 1. Prompt caching — not wired

**Newer adapter** (`src/llmConfig/adapters/anthropicAdapter.ts`, HEL-82):

```typescript
response = await client.messages.create({
  model: request.model,
  max_tokens: request.maxTokens ?? 4096,
  temperature: request.temperature,
  system: systemPrompt || undefined,   // ← never has cache_control
  messages: anthropicMessages,
  tools: tools.length > 0 ? tools : undefined,  // ← never has cache_control
  tool_choice: toolChoice,
});
```

The adapter is cache-aware on the *read* side — it pulls
`cache_read_input_tokens` from the response (line 142) and surfaces a
`cacheHit` boolean (line 148) — but it never sets
`cache_control: { type: 'ephemeral' }` on any content block when
sending. So no Anthropic request ever caches, and `cacheHit` is always
false.

**Older provider** (`src/engine/llmProviders/anthropic.ts`): doesn't
even read the cached-tokens field. No caching anywhere.

**What to cache and where:**

| Call site | Stable prefix | Recompute frequency |
|-----------|---------------|---------------------|
| Hiring plan generator (`src/missions/hiringPlanRoutes.ts`) | Role library (~3–8k tokens) + system prompt (~500) | Per mission — most calls are within 5 min of each other → great cache fit |
| Agent turn (`src/agents/runAgentTurn.ts`) | Agent identity card + workspace instructions + tool definitions | Same agent fires multiple times per cycle → great cache fit |
| Triage (when LLM invoker lands) | Agent identity card + triage policy body | Every wake event for that agent → great cache fit |
| Job description wizard (`src/agents/jobDescriptionWizard.ts`) | Role catalog + system prompt | Per wizard interaction — moderate fit |

**Implementation:** add a `cacheControl?: 'ephemeral'` flag to
`NormalizedRequest` system + tools + per-message-block, plumb to
`cache_control: { type: 'ephemeral' }` on the Anthropic side.
Five-minute TTL is the default; that's the right grain for our usage.

**Expected savings:** for the hiring plan path, a typical call sends
~6k tokens prompt, ~2k completion. With caching of the 4k-token
prefix, the second call within 5 min costs roughly:

- Without cache: 6k input × $0.003 = $0.018 prompt
- With cache: 2k uncached input × $0.003 + 4k cached × $0.0003 = $0.0072
- **60% reduction on the prompt side, ~30% on overall call cost**

Triage scales harder — at 10 events/min × 1k-token identity card, a
single workspace burns ~$50/month on just the identity-card re-sends.
Caching takes that to ~$5.

### 2. agentCheckIn is on Sonnet — should be Haiku

`src/agents/agentCheckIn.ts:132`:

```typescript
const model = resolveModelForTier(resolved.config.provider, "standard");
```

`"standard"` → `claude-sonnet-4-6` per `src/llmConfig/tierRouter.ts`.

The call's output contract is:
- `MAX_SUMMARY_CHARS = 240` (line 42)
- Structured: `{ state: "idle" | "working" | "blocked", summary: string }`
- Used to populate a one-line presence pill in the dashboard

Haiku handles this with zero quality loss. Sonnet is ~12× more
expensive on output. The button is clickable by every owner of every
agent, so it's a high-frequency call.

**Fix:** change `"standard"` → `"lite"`. One-line change.

### 3. `max_tokens: 4096` everywhere

Every call site in `src/engine/llmProviders/anthropic.ts` hardcodes
`max_tokens: 4096` (lines 103, 135, 220, 296). The newer adapter
defaults to the same when caller omits.

Specific over-allocations to fix:

| Call site | Realistic output | Current cap | Should be |
|-----------|-----------------|-------------|-----------|
| `agentCheckIn.ts` | ~50 tokens (240 chars) | 4096 | 200 |
| `priorityClassifier.ts` | ~10 tokens (single enum) | 4096 | 50 |
| `triagePolicy.ts` (when LLM invoker lands) | ~150 tokens (decision + reason) | 4096 | 300 |
| `jobDescriptionWizard.ts` | ~500 tokens (paragraph) | 4096 | 800 |
| `hiringPlanRoutes.ts` (generator) | ~2000 tokens (team structure JSON) | 4096 | 3000 |
| `runAgentTurn.ts` (general agent step) | varies widely | 4096 | leave at 4096 |

**Why bother if billing is metered on actual output?** Because
`max_tokens` affects model behavior. A model given 4096 tokens of
budget for a 50-token answer often rambles to ~500 tokens of
unnecessary preamble. Tight caps force tight answers — billing impact
is real, not theoretical.

### 4. LLM-backed triage will need caching from day one

`src/agents/triagePolicy.ts` currently ships with `DEFAULT_TRIAGE_INVOKER`
that returns rule-based decisions (zero LLM cost). The header comment
says the LLM invoker is "pluggable via the `triageInvoke` dependency
injection so the unit tests don't need a live provider."

When that lands:

- Triage fires on **every** wake event (webhooks, mentions, approvals,
  upstream completions, scheduled ticks).
- Each call carries the agent identity card (stable per-agent) +
  policy body (stable per-agent) + the event payload (varies).
- The fixed prefix is the cacheable part. Without caching, an agent
  handling 100 events/hour pays for the identity card 100 times.

**Action:** when wiring the LLM invoker, the request shape MUST mark
the identity-card-plus-policy-body block as `cache_control: ephemeral`.
This is a forward-compat ticket so the gap doesn't ship.

## Tier-routing naming — there are two distinct routers (no normalization needed)

**Correction from Codex review:** my original audit framed this as a
naming inconsistency to normalize. It is not — there are two
DIFFERENT tier routers serving different abstraction layers, and the
production call sites already use the right names.

- `src/engine/llmRouter.ts` defines `LlmTier = "lite" | "standard" | "power"`
  with `TIER_MODELS[provider][tier]`. This is the per-call tier used
  by every production caller (`agentCheckIn`, `runAgentTurn`,
  `priorityClassifier`, `jobDescriptionWizard`, `missionRoutes`,
  `hiringPlanRoutes`). All six callers go through this router.
- `src/llmConfig/tierRouter.ts` defines `TierKey = "small" | "medium"
  | "large" | "embeddings" | "vision"` — the HEL-81 workspace-level
  tier matrix. Intended to back the future HEL-82 adapter call
  surface; NOT yet wired into production calls.

The two are independent. The HEL-146 PR correctly skipped the rename
when I dug into it — there was nothing to normalize.

## What's good already

- **Structured-output mode is on** in the adapter (`responseSchema` →
  forced tool call) — that's the right pattern, avoids wasted tokens
  on JSON-formatting preamble.
- **`priorityClassifier.ts` already uses Haiku** (`"lite"` tier) — the
  pattern works when applied.
- **Triage default is rule-based** — cost is currently zero. Only the
  future LLM-backed path needs the caching guardrail.
- **Cost telemetry exists** — `hiringPlanCost.ts` has per-model
  pricing tables. Easy to extend into a workspace-level usage
  dashboard once we want one.

## Filed tickets

- **HEL-145** — Enable Anthropic prompt caching on system + tools + identity blocks
- **HEL-146** — Downgrade agentCheckIn to Haiku tier + normalize tier naming
- **HEL-147** — Set per-call-type max_tokens caps
- **HEL-148** — When LLM triage invoker lands, cache agent identity card + policy body
