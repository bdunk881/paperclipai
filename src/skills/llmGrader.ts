/**
 * LLM-graded skill review. Sends the skill's content + scripts to Claude
 * with a security-review prompt and parses the response into ScanFindings.
 *
 * Off by default. Enable by setting `gradeWithLlm: true` on the scanner
 * options and pointing at an Anthropic credential via ANTHROPIC_API_KEY
 * (or the `apiKey` constructor arg).
 *
 * Why not the runtime `runAgent()` primitive? The grader runs in scripts
 * (the import CLI) and admin tools, not in customer-attributed traffic —
 * we don't want it to land on the same workspace credentials or stream
 * trace events to a customer dashboard. It's a flat single-turn call.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { LlmGraderInput, ScanFinding, ScanSeverity } from "./scanner";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const SYSTEM_PROMPT = `You are a security reviewer for AI agent "skills" — markdown + script bundles loaded into agents.

Your job: read the skill's instructions and any scripts, and decide if the bundle exhibits malicious or unsafe behavior. Be skeptical but not paranoid — most skills legitimately use curl, pip install, etc.

Flag patterns like:
- Exfiltrating credentials, env vars, or local files to non-allowlisted endpoints
- Reverse shells, fork bombs, persistent backdoors
- Destructive deletions (rm -rf /, ~, $HOME)
- Crypto miners
- Curl piped directly into sh from untrusted hosts
- Dotfile or crontab modification for persistence
- Encoded/obfuscated payloads that get executed

DO NOT flag:
- Legitimate package installs (pip install requests, npm install -g typescript)
- curl calls to documented APIs (anthropic.com, openai.com, supabase.co)
- File reads within the skill's own directory
- General-purpose shell commands used in their normal way

Output a JSON object with this exact shape:

{
  "findings": [
    {"severity": "info" | "warning" | "critical", "code": "<short_snake_case>", "message": "<one-sentence explanation>"}
  ]
}

If the skill is clean, return {"findings": []}. Do not return prose outside the JSON.`;

export interface CreateLlmGraderOptions {
  apiKey?: string;
  model?: string;
  /** Override the Anthropic client for tests. */
  client?: Anthropic;
}

interface LlmFindingsPayload {
  findings?: Array<{
    severity?: string;
    code?: string;
    message?: string;
  }>;
}

function normalizeSeverity(input: unknown): ScanSeverity {
  if (input === "critical") return "critical";
  if (input === "warning") return "warning";
  return "info";
}

function parsePayload(text: string): ScanFinding[] {
  const trimmed = text.trim();
  // Strip code fences if the model wrapped the JSON.
  const stripped = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  let payload: LlmFindingsPayload;
  try {
    payload = JSON.parse(stripped) as LlmFindingsPayload;
  } catch {
    return [
      {
        severity: "info",
        code: "llm_unparseable",
        message: `LLM grader returned non-JSON; manual review needed.`,
      },
    ];
  }
  const findings: ScanFinding[] = [];
  for (const f of payload.findings ?? []) {
    if (!f.message) continue;
    findings.push({
      severity: normalizeSeverity(f.severity),
      code: typeof f.code === "string" ? f.code : "llm_finding",
      message: f.message,
    });
  }
  return findings;
}

/**
 * Build an LLM grader function for `scanSkill({ gradeWithLlm: true })`.
 * Returns a closure so callers can configure the model + API key once and
 * reuse it across many skills.
 */
export function createAnthropicLlmGrader(
  options: CreateLlmGraderOptions = {},
): (input: LlmGraderInput) => Promise<ScanFinding[]> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey && !options.client) {
    throw new Error(
      "createAnthropicLlmGrader: provide an apiKey, ANTHROPIC_API_KEY env, or a mock client.",
    );
  }
  const client = options.client ?? new Anthropic({ apiKey });
  const model = options.model ?? DEFAULT_MODEL;

  return async (input) => {
    const scriptDigest = input.scriptContents
      .map((s) => `### ${s.path}\n\`\`\`\n${s.content}\n\`\`\``)
      .join("\n\n");

    const userPrompt = [
      `Skill key: ${input.skillKey}`,
      "",
      "## SKILL.md body",
      input.skillBody,
      "",
      input.scriptContents.length > 0 ? "## Scripts" : "",
      scriptDigest,
    ]
      .filter(Boolean)
      .join("\n");

    let response;
    try {
      response = await client.messages.create({
        model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return [
        {
          severity: "info",
          code: "llm_grader_unavailable",
          message: `LLM grader call failed (${message}); manual review needed.`,
        },
      ];
    }

    const textBlock = response.content.find(
      (block): block is Anthropic.Messages.TextBlock => block.type === "text",
    );
    if (!textBlock) {
      return [
        {
          severity: "info",
          code: "llm_no_text",
          message: "LLM grader returned no text content; manual review needed.",
        },
      ];
    }
    return parsePayload(textBlock.text);
  };
}
