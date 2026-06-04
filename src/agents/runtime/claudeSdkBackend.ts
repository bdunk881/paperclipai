/**
 * ClaudeSdkBackend — agent backend that drives a Claude run via the
 * official `@anthropic-ai/claude-agent-sdk`.
 *
 * Architecture notes:
 *   - The SDK is ESM-only; this file is loaded via CommonJS, so the SDK is
 *     pulled in via dynamic `import()` from inside `run()`.
 *   - The SDK spawns the embedded Claude Code CLI as a subprocess and
 *     drives the conversation via stdio. That's heavier than the bare
 *     Anthropic API call path, but it's what unlocks native subagents,
 *     MCP, Skills, permission modes, and the hooks system.
 *   - Our `AgentTool[]` are exposed to the SDK via a single in-process
 *     SDK MCP server (`createSdkMcpServer` + `tool()`). The model sees
 *     them as `mcp__autoflow__<toolName>`.
 *   - We disable every built-in Claude Code tool (`tools: []`) so the
 *     model can only call our registered MCP tools — no filesystem, no
 *     Bash, no WebFetch in a SaaS workspace context.
 *   - Permissions are bypassed (`permissionMode: 'bypassPermissions'`)
 *     because tool gating already lives in `agentToolPermissions.ts` and
 *     is applied to `tools` before they reach this backend.
 *
 * Roll-out: this backend is opt-in via the `AUTOFLOW_AGENT_SDK_ENABLED`
 * env var. Default agent traffic continues through FallbackAgentBackend.
 */

import type { AgentTool } from "../../engine/llmProviders/types";
import { emitTrace } from "../../engine/agentTrace/emitCallbacks";
import { previewToolOutput } from "../../engine/agentTrace/redact";
import {
  SUBSCRIPTION_AUTH_ENV_VARS,
  assertAnthropicApiKeyForCredits,
} from "../../billing/credits/anthropicCreditsAuth";
import { jsonSchemaToZodShape } from "./jsonSchemaToZod";
import {
  appendSkillsToPrompt,
  resolveSkills,
  type LoadedSkill,
} from "../../skills/skillsLoader";
import type {
  AgentBackend,
  AgentHooks,
  AgentMcpServer,
  AgentPermissionMode,
  AgentRunInput,
  AgentRunResult,
  ResolvedModelBinding,
} from "./types";

const DEFAULT_MAX_TURNS = 8;

/**
 * Build the subprocess env for the Claude Agent SDK, guaranteeing API-key
 * billing (HEL-602).
 *
 * The SDK spawns the embedded Claude Code CLI, which will authenticate via
 * a subscription-OAuth token (`CLAUDE_CODE_OAUTH_TOKEN`) or a bearer
 * override (`ANTHROPIC_AUTH_TOKEN`) in preference to `ANTHROPIC_API_KEY`.
 * Since the 2026-06-15 billing split, subscription-OAuth calls draw from a
 * separate capped pool instead of our prepaid balance. We therefore (1)
 * reject an OAuth token mistakenly wired in as the binding key, and (2)
 * strip those ambient auth env vars from the spawned env so nothing can
 * override the explicit API key. Exported (not inlined) so it's
 * unit-testable without the dynamically imported SDK.
 */
export function buildAnthropicSdkEnv(
  binding: Pick<ResolvedModelBinding, "provider" | "apiKey">,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (binding.provider === "anthropic") {
    assertAnthropicApiKeyForCredits({
      provider: binding.provider,
      apiKey: binding.apiKey,
      sourceLabel: "claude_sdk binding",
    });
  }
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  for (const name of SUBSCRIPTION_AUTH_ENV_VARS) {
    delete env[name];
  }
  env.ANTHROPIC_API_KEY = binding.apiKey;
  return env;
}

export class ClaudeSdkBackend implements AgentBackend {
  readonly name = "claude_sdk" as const;

  async run(
    input: AgentRunInput,
    binding: ResolvedModelBinding,
  ): Promise<AgentRunResult> {
    const sdk = await loadSdk();

    const tools = input.tools ?? [];
    const toolsByName = new Map(tools.map((t) => [t.name, t]));

    const mcpToolDefs = tools.map((t) =>
      sdk.tool(
        t.name,
        t.description,
        jsonSchemaToZodShape(t.inputSchema),
        async (args) => invokeToolWithHooks(t.name, args, toolsByName, input),
      ),
    );

    const sdkServer = sdk.createSdkMcpServer({
      name: "autoflow",
      version: "1.0.0",
      tools: mcpToolDefs,
    });

    const loadedSkills = resolveSkills(input.skills ?? []);
    const agents = buildSubagentDefs(input, loadedSkills);

    if (input.onTrace) {
      emitTrace(input.onTrace, { type: "turn.started", at: new Date().toISOString() });
    }

    const mcpServers: Record<string, unknown> = { autoflow: sdkServer };
    for (const server of input.mcpServers ?? []) {
      mcpServers[server.name] = buildExternalMcpServerConfig(server);
    }

    const permissionMode = mapPermissionMode(input.permissionMode);

    const query = sdk.query({
      prompt: input.userPrompt,
      options: {
        model: binding.model,
        systemPrompt: appendSkillsToPrompt(input.systemPrompt, loadedSkills),
        maxTurns: input.maxToolIterations ?? DEFAULT_MAX_TURNS,
        tools: [],
        mcpServers,
        agents,
        permissionMode,
        allowDangerouslySkipPermissions: permissionMode === "bypassPermissions",
        persistSession: false,
        env: buildAnthropicSdkEnv(binding),
      },
    });

    let finalText = "";
    let promptTokens = 0;
    let completionTokens = 0;
    let cachedPromptTokens: number | undefined;

    try {
      for await (const message of query) {
        const msg = message as Record<string, unknown>;
        if (msg.type === "assistant" && input.onTrace) {
          const inner = msg.message as { content?: Array<Record<string, unknown>> } | undefined;
          const blocks = inner?.content ?? [];
          for (const b of blocks) {
            if (b.type === "text" && typeof b.text === "string" && b.text) {
              emitTrace(input.onTrace, {
                type: "assistant.delta",
                delta: b.text,
                accumulated: b.text,
              });
            } else if (b.type === "tool_use") {
              emitTrace(input.onTrace, {
                type: "tool_call.completed",
                callId: String(b.id ?? ""),
                name: String(b.name ?? ""),
                arguments: (b.input as Record<string, unknown> | undefined) ?? {},
              });
            }
          }
        } else if (msg.type === "result") {
          if (msg.subtype === "success") {
            finalText = typeof msg.result === "string" ? msg.result : "";
            const usage = (msg.usage as Record<string, number | undefined>) ?? {};
            promptTokens = usage.input_tokens ?? 0;
            completionTokens = usage.output_tokens ?? 0;
            const cached = usage.cache_read_input_tokens;
            cachedPromptTokens = typeof cached === "number" && cached > 0 ? cached : undefined;
          } else {
            throw new Error(`Claude SDK run failed: ${JSON.stringify(msg)}`);
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (input.onTrace) emitTrace(input.onTrace, { type: "turn.error", message });
      throw err;
    }

    const usage = {
      promptTokens,
      completionTokens,
      cachedPromptTokens,
    };

    if (input.onTrace) {
      emitTrace(input.onTrace, { type: "turn.completed", text: finalText, usage });
    }

    return {
      text: finalText,
      usage,
      provider: binding.provider,
      model: binding.model,
      backend: this.name,
    };
  }
}

/**
 * Convert our SubagentRef[] into the SDK's `agents` map. The SDK invokes
 * a subagent when the parent model emits an Agent tool call with the
 * matching name — this is what makes org-chart delegation native.
 *
 * Skills propagate to subagents by folding the parent's loaded skill
 * bodies into the subagent's `prompt`, NOT via the SDK's native
 * `skills:` option. This keeps the behavior identical between the
 * Claude SDK backend and the OpenAI Agents handoff path — same prompt
 * structure on both, so a customer can swap providers without
 * re-authoring any skill content.
 */
function buildSubagentDefs(
  input: AgentRunInput,
  parentSkills: LoadedSkill[],
): Record<string, ClaudeAgentDef> | undefined {
  if (!input.subagents || input.subagents.length === 0) return undefined;
  const out: Record<string, ClaudeAgentDef> = {};
  for (const sub of input.subagents) {
    const base = `You are ${sub.name}, a ${sub.roleKey}. Carry out the task delegated to you and return a concise summary.`;
    out[sub.name] = {
      description: sub.description,
      prompt: appendSkillsToPrompt(base, parentSkills),
      tools: [],
    };
  }
  return out;
}

/** Map our AgentPermissionMode → the SDK's permissionMode value. */
function mapPermissionMode(mode: AgentPermissionMode | undefined): string {
  switch (mode) {
    case "plan":
      return "plan";
    case "review":
      return "default";
    case "auto":
    case undefined:
    default:
      return "bypassPermissions";
  }
}

/** Translate our AgentMcpServer into the SDK's HTTP MCP server config. */
function buildExternalMcpServerConfig(server: AgentMcpServer): Record<string, unknown> {
  const config: Record<string, unknown> = {
    type: "http",
    url: server.url,
  };
  if (server.authorization) {
    config.headers = { Authorization: server.authorization };
  }
  return config;
}

/**
 * Tool wrapper that runs the pre/post-tool hooks. PreToolUse can veto
 * the call (returning `{ continue: false }` makes us surface a clean
 * error to the model instead of executing the handler). PostToolUse is
 * fire-and-forget for accounting / audit logging.
 */
async function invokeToolWithHooks(
  toolName: string,
  args: unknown,
  toolsByName: Map<string, AgentTool>,
  input: AgentRunInput,
): Promise<ClaudeToolResult> {
  const handler = toolsByName.get(toolName);
  if (!handler) {
    return {
      content: [{ type: "text", text: `Tool "${toolName}" is not registered.` }],
      isError: true,
    };
  }

  const toolInput = (args ?? {}) as Record<string, unknown>;

  if (input.hooks?.preToolUse) {
    try {
      const decision = await input.hooks.preToolUse({ toolName, toolInput });
      if (decision && decision.continue === false) {
        const reason = decision.reason ?? "Pre-tool-use hook blocked this call.";
        if (input.onTrace) {
          emitTrace(input.onTrace, {
            type: "tool_call.failed",
            callId: toolName,
            name: toolName,
            error: reason,
          });
        }
        return { content: [{ type: "text", text: reason }], isError: true };
      }
    } catch (err) {
      // Hook errors must not break the tool path; treat as approve + log.
      console.warn(
        `[claudeSdkBackend] preToolUse hook threw on ${toolName}: ${(err as Error).message}`,
      );
    }
  }

  try {
    const result = await handler.handler(toolInput);
    if (input.onTrace) {
      emitTrace(input.onTrace, {
        type: "tool_result",
        callId: toolName,
        name: toolName,
        outputPreview: previewToolOutput(result),
      });
    }
    if (input.hooks?.postToolUse) {
      try {
        await input.hooks.postToolUse({ toolName, toolInput, result });
      } catch (err) {
        console.warn(
          `[claudeSdkBackend] postToolUse hook threw on ${toolName}: ${(err as Error).message}`,
        );
      }
    }
    const text = typeof result === "string" ? result : JSON.stringify(result);
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (input.onTrace) {
      emitTrace(input.onTrace, {
        type: "tool_call.failed",
        callId: toolName,
        name: toolName,
        error: message,
      });
    }
    if (input.hooks?.postToolUse) {
      try {
        await input.hooks.postToolUse({ toolName, toolInput, result: null, error: message });
      } catch (hookErr) {
        console.warn(
          `[claudeSdkBackend] postToolUse hook threw on error path: ${(hookErr as Error).message}`,
        );
      }
    }
    return {
      content: [{ type: "text", text: `Tool "${toolName}" failed: ${message}` }],
      isError: true,
    };
  }
}

/**
 * Dynamic-import the ESM-only Claude Agent SDK from our CommonJS module.
 * The import is cached after the first call; subsequent runs hit a
 * resolved promise.
 */
let cachedSdk: Promise<ClaudeSdkModule> | null = null;
async function loadSdk(): Promise<ClaudeSdkModule> {
  if (cachedSdk) return cachedSdk;
  cachedSdk = (Function('return import("@anthropic-ai/claude-agent-sdk")')() as Promise<ClaudeSdkModule>);
  return cachedSdk;
}

interface ClaudeAgentDef {
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
}

// Minimal shape of the SDK module we touch. Avoids pulling in zod-v4-only
// type imports across the project's CJS boundary.
interface ClaudeSdkModule {
  query: (params: {
    prompt: string;
    options?: Record<string, unknown>;
  }) => AsyncGenerator<unknown, void>;
  tool: (
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    handler: (args: unknown, extra: unknown) => Promise<ClaudeToolResult>,
  ) => unknown;
  createSdkMcpServer: (opts: {
    name: string;
    version?: string;
    tools?: unknown[];
  }) => unknown;
}

interface ClaudeToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}
