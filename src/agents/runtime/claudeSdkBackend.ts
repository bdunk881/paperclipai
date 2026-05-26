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
import { jsonSchemaToZodShape } from "./jsonSchemaToZod";
import type {
  AgentBackend,
  AgentRunInput,
  AgentRunResult,
  ResolvedModelBinding,
} from "./types";

const DEFAULT_MAX_TURNS = 8;

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
      sdk.tool(t.name, t.description, jsonSchemaToZodShape(t.inputSchema), async (args) => {
        const handler = toolsByName.get(t.name);
        if (!handler) {
          return {
            content: [{ type: "text", text: `Tool "${t.name}" is not registered.` }],
            isError: true,
          };
        }
        try {
          const result = await handler.handler(args as Record<string, unknown>);
          if (input.onTrace) {
            emitTrace(input.onTrace, {
              type: "tool_result",
              callId: t.name,
              name: t.name,
              outputPreview: previewToolOutput(result),
            });
          }
          const text = typeof result === "string" ? result : JSON.stringify(result);
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (input.onTrace) {
            emitTrace(input.onTrace, {
              type: "tool_call.failed",
              callId: t.name,
              name: t.name,
              error: message,
            });
          }
          return {
            content: [{ type: "text", text: `Tool "${t.name}" failed: ${message}` }],
            isError: true,
          };
        }
      }),
    );

    const sdkServer = sdk.createSdkMcpServer({
      name: "autoflow",
      version: "1.0.0",
      tools: mcpToolDefs,
    });

    const agents = buildSubagentDefs(input);

    if (input.onTrace) {
      emitTrace(input.onTrace, { type: "turn.started", at: new Date().toISOString() });
    }

    const query = sdk.query({
      prompt: input.userPrompt,
      options: {
        model: binding.model,
        systemPrompt: input.systemPrompt,
        maxTurns: input.maxToolIterations ?? DEFAULT_MAX_TURNS,
        tools: [],
        mcpServers: { autoflow: sdkServer },
        agents,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        persistSession: false,
        env: { ...process.env, ANTHROPIC_API_KEY: binding.apiKey },
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
 */
function buildSubagentDefs(input: AgentRunInput): Record<string, ClaudeAgentDef> | undefined {
  if (!input.subagents || input.subagents.length === 0) return undefined;
  const out: Record<string, ClaudeAgentDef> = {};
  for (const sub of input.subagents) {
    out[sub.name] = {
      description: sub.description,
      prompt: `You are ${sub.name}, a ${sub.roleKey}. Carry out the task delegated to you and return a concise summary.`,
      tools: [],
    };
  }
  return out;
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
