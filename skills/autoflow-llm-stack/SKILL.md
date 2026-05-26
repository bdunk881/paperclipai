---
name: autoflow-llm-stack
description: >
  AutoFlow LLM + agent runtime reference — tier routing (small/medium/large/
  embeddings/vision), provider adapters (NormalizedRequest/Response),
  the three agent backends (ClaudeSdkBackend, OpenAIAgentsBackend,
  FallbackAgentBackend), the three-layer memory model (instructions,
  knowledge, episodes), the org-chart-aware retrieval ranker, wake-event
  triage, and how skills get injected into prompts. Use when working in
  src/llmConfig/, src/agents/, src/memory/, src/knowledge/, src/episodes/,
  src/mcp/, or src/skills/.
license: Proprietary. Apache-style with the AutoFlow trademark carve-out.
---

# AutoFlow LLM + Agent Runtime Reference

AutoFlow is multi-provider, BYOK-first, and vendor-agnostic at every layer
above the wire format. A workspace can be all-Anthropic, all-OpenAI, or
mixed; the code never asks "what model" — it asks "what tier" and lets the
workspace's matrix decide.

This skill captures the runtime architecture across `src/llmConfig/`,
`src/agents/`, `src/memory/`, `src/knowledge/`, `src/episodes/`, `src/mcp/`,
and `src/skills/`. Architectural background lives in [AGENTS.md §"Cross-model
agents + the three-layer memory model"](../../AGENTS.md).

---

## 1. Tier routing (HEL-81)

`src/llmConfig/tierRouter.ts` resolves a logical tier to a concrete
`{ provider, model, credentialId? }`. Five tier keys, fixed:

```ts
type TierKey = "small" | "medium" | "large" | "embeddings" | "vision";
```

Every feature in the platform — agent reasoning, triage, embeddings,
classification, structured output — picks a tier, never a specific model.
That's what lets the same code run on a Claude-only or OpenAI-only or
mixed workspace.

Resolution order:

1. **Per-agent override** — `agents.tier_overrides` JSONB, if present.
2. **Workspace matrix** — `workspaces.tier_routing` JSONB (migration 033).
3. **Inferred default** — `getDefaultTierMatrix(connectedProviders)` picks
   cheapest small, best medium (Anthropic Sonnet → OpenAI 4.x → Gemini Pro
   → Mistral), best large (Opus → GPT-5 → Gemini Pro), OpenAI
   `text-embedding-3-small` for embeddings if available, first vision-capable
   medium-tier provider.

`PROVIDER_TIER_DEFAULTS` in `tierRouter.ts` is the source of truth for
which model name to pick per provider at each tier. Update it when a
provider ships a new tier-leading model — do **not** spread per-provider
model names across other files.

```ts
import { tierRouter } from "../llmConfig/tierRouter";
const binding = await tierRouter.resolveTier(workspaceId, "small", agentId);
// → { provider: "anthropic", model: "claude-haiku-4-5-20251001", credentialId: "..." }
```

---

## 2. Provider adapters (HEL-82)

`src/llmConfig/adapters/` normalises six provider wire formats behind a
single `NormalizedRequest` / `NormalizedResponse` shape:

| Provider | Adapter | SDK |
|---|---|---|
| Anthropic | `anthropicAdapter.ts` | `@anthropic-ai/sdk` |
| OpenAI | `openaiAdapter.ts` | `openai` |
| Bedrock | `bedrockAdapter.ts` | `@aws-sdk/client-bedrock-runtime` |
| Gemini | `geminiAdapter.ts` | `@google/generative-ai` |
| Mistral | `mistralAdapter.ts` | `@mistralai/mistralai` |
| Vertex AI | `vertexAdapter.ts` | `@google-cloud/vertexai` |

OpenAI-compatible long-tail (`groq`, `fireworks`, `together`, `xai`,
`perplexity`, `deepseek`, `ollama`, `localai`, `opencode_zen`) and Cohere
still go through the legacy `src/engine/llmProviders/*` path. Don't add a
new provider through that path — extend `src/llmConfig/adapters/` instead.

Adapter contract (`src/llmConfig/adapters/types.ts`):

```ts
interface ProviderAdapter {
  invoke(request: NormalizedRequest, credentials, traceCallback?):
    Promise<NormalizedResponse>;
}
```

Tool calls + JSON-schema structured outputs work uniformly across
providers. The adapter parses tool arguments from JSON before returning so
callers always get `Record<string, unknown>` regardless of provider.

---

## 3. Agent backends (`src/agents/runtime/`)

Three backends implement `AgentBackend.run(input, binding)`:

| Backend | Use | SDK |
|---|---|---|
| `ClaudeSdkBackend` | Anthropic provider + `AUTOFLOW_AGENT_SDK_ENABLED` flag | `@anthropic-ai/claude-agent-sdk` |
| `OpenAIAgentsBackend` | OpenAI provider + flag | `@openai/agents` |
| `FallbackAgentBackend` | Default — hand-rolled loop on top of `NormalizedRequest` | adapter layer |

Backend selection (`src/agents/runtime/runAgent.ts:pickBackend`):

```ts
if (AUTOFLOW_AGENT_SDK_ENABLED && provider === "anthropic") → ClaudeSdkBackend
if (AUTOFLOW_AGENT_SDK_ENABLED && provider === "openai")    → OpenAIAgentsBackend
otherwise                                                    → FallbackAgentBackend
```

The fallback is the default and is **battle-tested across every provider**.
Native SDK backends are validated incrementally; both expose the same
`AgentRunResult` shape so callers don't branch.

Every caller goes through `runAgent()` in `src/agents/runtime/runAgent.ts`
or `runAgentTurn()` in `src/agents/runAgentTurn.ts`. **Never** instantiate
a provider SDK directly in a handler or a domain module.

---

## 4. Agent run inputs

`AgentRunInput` (in `src/agents/runtime/types.ts`) defines everything a turn
sees:

- `systemPrompt` / `userPrompt` — the prompt frame.
- `tier` — `"lite" | "standard" | "power"` (mapped to small/medium/large in
  the runner).
- `tools` — caller-supplied tools (e.g. memory tool, integration handlers).
- `subagents` — agents this one can `delegate_to_subagent` to.
- `mcpServers` — MCP servers exposed as tool sources during the run.
- `skills` — stored agent skill keys. Backends that support skills load the
  SKILL.md body and inject it into the system prompt.
- `permissionMode` — `"auto" | "plan" | "review"` (maps to Claude Agent SDK).
- `hooks.preToolUse / postToolUse` — used for budget enforcement (a denied
  pre-hook turns into a tool error the model sees) and spend accounting.

`runAgentTurn` automatically resolves `skills` from `agents.skills[]` if the
caller doesn't override.

---

## 5. Skills as prompt fragments (`src/skills/skillsLoader.ts`)

Skills are vendor-agnostic by design. The loader reads `SKILL.md` files
from `skills/<key>/` (each a YAML frontmatter + markdown body), and
`formatSkillsForPrompt()` concatenates them into a markdown section
appended to the system prompt:

```
# SKILLS AVAILABLE
The following capability bundles are loaded for this run. Read them like
reference docs — they describe how to approach specific tasks.

### skill-name
<description>

<body>

---

### next-skill
…
```

This is what makes a skill work identically on Claude, OpenAI, Gemini,
Bedrock, Vertex, Mistral, and every OpenAI-compatible provider — every
backend folds the section in the same way.

Skills are immutable per release: the loader caches the directory walk in
process. Restart the API after `npm run skills:import`.

---

## 6. Three-layer memory (HEL-86 → HEL-91)

| Layer | Table | Module | Role |
|---|---|---|---|
| 1 — Instructions | `workspace_instructions` | `src/instructions/` | Human-authored markdown always inlined into the system prompt. Also stores per-agent `triage_policy` rows. |
| 2 — Knowledge | `knowledge_items` | `src/knowledge/` | Durable RAG-retrievable facts. pgvector. Conflicts via `superseded_by`. |
| 3 — Episodes | `agent_episodes` | `src/episodes/` | Append-only log of observations / action results / reflections / escalations. 90-day TTL. |

Two visibility scopes only: `autoflow_curated` (global, AutoFlow-managed)
and `workspace`. `mission_id` + `author_agent_id` are **retrieval-relevance
tags**, never visibility walls — memory is shared across all agents in a
workspace by default.

Reflection (HEL-91, `src/knowledge/reflectionJob.ts`) periodically reads
episodes, synthesises recurring patterns, and graduates them to Layer 2.

---

## 7. Org-chart-aware retrieval ranker (HEL-89)

`src/knowledge/retrievalRanker.ts` composes scores from vector similarity
+ structural weights. The differentiator: a subagent's **manager's** memories
rank higher than a stranger agent's. Generic vector retrieval treats agents
as isolated; AutoFlow's are employees with reporting lines (`org_edges`).

Composite formula:

```
final_score = base_similarity
            × layer_weight     (knowledge=1.0, episode=0.5)
            × trust_weight     (verified=1.2, document=1.0, pull=0.9, syn=0.85)
            × scope_weight     (workspace=1.0, autoflow_curated=0.7)
            × mission_weight   (current=1.3, other=0.6, none=1.0)
            × org_weight       (manager=1.1, peer=1.0, own=0.9, stranger=0.7)
            × recency_weight   (exp(-age_days / 30))
```

All weight functions are pure; tests inject `now` and an org-graph
snapshot for determinism.

---

## 8. Wake-event triage (HEL-94)

Heartbeat polling is too expensive. Each potential wake source
(scheduled cron, inbound webhook, @-mention, approval resolution, direct
user message, upstream completion) publishes to `wake_events` →
`src/agents/triagePolicy.ts` applies the **agent's own** `triage_policy` →
one of `ACT / DEFER / IGNORE / ESCALATE`.

Key insight: the triage call uses the agent's own authored policy executed
cheaply at `tier=small` (~$0.0005/event), not generic external judgment.
The platform delegates; it doesn't override.

Default policy (when no `triage_policy` is configured): ACT on @-mentions
+ approval-resolved, DEFER everything else.

Persistence + the actual LLM call are dependency-injected so tests don't
need a live provider.

---

## 9. MCP integration (`src/mcp/`)

`src/agents/runtime/mcpClient.ts` + `mcpToolBridge.ts` bridge MCP servers
into the agent runtime. `loadAgentMcpServers({ userId })` reads the user's
configured MCP servers and returns the `AgentMcpServer[]` array that goes
into `AgentRunInput.mcpServers`.

`src/mcp/mcpUrlSecurity.ts` enforces a URL allowlist before any tool call —
don't bypass it. Adding a new MCP integration goes through `src/mcp/mcpStore.ts`,
not by hardcoding URLs.

---

## 10. Budget enforcement (preToolUse hook)

`src/agents/runtime/budgetHook.ts:createBudgetHook()` returns the
`preToolUse` / `postToolUse` pair every run wires unless
`enforceBudget: false` is set. A denied pre-hook turns into a tool error
the model sees ("budget exceeded; cannot continue"), so it can react in
the same turn rather than silently failing mid-loop.

`spend_entries` get the actual numbers; `budget_alerts` fires on threshold
crossings.

---

## 11. Tool call conventions

Tools are JSON-Schema-typed (`ToolSpec.parameters`). The adapter layer
translates to provider-specific tool formats. When you add a tool:

- Name it in `snake_case` (cross-provider convention).
- Provide a clear `description` — the model picks the tool based on this.
- JSON Schema parameters with `type`, `properties`, `required`.
- Return a stringified result (`NormalizedToolResult.content` is `string`).
  For structured returns, JSON-stringify it.

For agent → agent delegation, use the built-in `delegate_to_subagent` tool
(`src/agents/runtime/delegateToSubagentTool.ts`); don't hand-roll the
subagent invocation.

---

## 12. Forbidden patterns

- ❌ Importing a provider SDK directly in a handler / domain module — go
  through the tier router + adapter layer.
- ❌ Hardcoding a model name outside `PROVIDER_TIER_DEFAULTS` — break tier
  routing and break Brad's customers' workspaces.
- ❌ Using the legacy `engine/llmProviders/*` path for a new provider —
  extend `src/llmConfig/adapters/` instead.
- ❌ Treating `mission_id` or `author_agent_id` as a visibility wall — they
  are retrieval-relevance tags only.
- ❌ Sleeping in a poll loop waiting for an agent — wake events are the
  pattern.
- ❌ Skipping `AgentMcpServer` allowlist via `mcpUrlSecurity.ts`.
- ❌ Bypassing `budgetHook` in production code paths.
