/**
 * Hand-off priority classifier (DASH-15 / HEL-134).
 *
 * Called from the Hand-off modal as the owner types: takes the
 * proposed title + optional description, asks the workspace's
 * lite-tier LLM to bucket the task into one of:
 *   - "low"     — nice to have, no time pressure
 *   - "medium"  — normal cycle
 *   - "high"    — front of the queue
 *   - "urgent"  — drop other work for this
 *
 * The classifier is opportunistic. Whenever the LLM can't be
 * reached (no provider configured, network error, parse failure,
 * etc.) we return `null` and the route surfaces a 204 — the modal
 * just keeps the user's manual default. Never blocks the actual
 * hand-off.
 *
 * Heuristic-style prompt: small, deterministic, returns a single
 * JSON object. Cost target is ~$0.0001/call at lite-tier rates
 * (think Haiku, Mistral-small, GPT-4o-mini). Cap response tokens at
 * 64 since the schema is two short fields.
 */

import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { resolveModelForTier } from "../engine/llmRouter";
import { getProvider } from "../engine/llmProviders";
import { extractStructuredOutput } from "../engine/structuredOutput";

export type HandoffPriority = "low" | "medium" | "high" | "urgent";

export interface PriorityClassification {
  priority: HandoffPriority;
  reason: string;
}

interface ClassifyInput {
  userId: string;
  title: string;
  description?: string;
}

const CLASSIFY_TIMEOUT_MS = 8_000;
const MAX_REASON_CHARS = 160;

/**
 * Returns the classifier's suggestion, or `null` when we couldn't
 * produce one. Never throws — callers can rely on null being the
 * "no suggestion" sentinel.
 */
export async function classifyHandoffPriority(
  input: ClassifyInput,
): Promise<PriorityClassification | null> {
  let resolved;
  try {
    resolved = await llmConfigStore.getDecryptedDefault(input.userId);
  } catch {
    return null;
  }
  if (!resolved) return null;

  const model = resolveModelForTier(resolved.config.provider, "lite");
  const provider = getProvider({
    provider: resolved.config.provider,
    model,
    apiKey: resolved.apiKey,
    responseFormat: { type: "json_object" },
    requestTimeoutMs: CLASSIFY_TIMEOUT_MS,
  });

  const prompt = buildPrompt({
    title: input.title,
    description: input.description,
  });

  let raw: string;
  try {
    const response = await provider(prompt);
    raw = response.text;
  } catch {
    return null;
  }

  try {
    return parseClassification(raw);
  } catch {
    return null;
  }
}

/**
 * Exported for testability — the prompt content drives the
 * classifier's behavior so a regression test should be able to
 * lock its shape without spinning up an LLM.
 */
export function buildPrompt(args: { title: string; description?: string }): string {
  const desc = args.description?.trim();
  return [
    "You are an AutoFlow scheduling assistant. The user is creating a hand-off task for an AI agent.",
    "Bucket the task into ONE priority: low, medium, high, or urgent.",
    "",
    "Guidance:",
    '- "urgent" — the user explicitly says now / today / drop everything / customer escalation / outage / VIP.',
    '- "high"   — same-week deadline, blocker for another person, named customer impact.',
    '- "medium" — normal day-to-day work, no time pressure called out.',
    '- "low"    — exploratory, "when you get a chance", "no rush", nice-to-haves.',
    "",
    "Return JSON ONLY with this exact shape:",
    '{ "priority": "low" | "medium" | "high" | "urgent", "reason": "<one short sentence, ≤ 160 chars>" }',
    "",
    "Task:",
    `Title: ${args.title}`,
    desc ? `Description: ${desc}` : "Description: (none)",
  ].join("\n");
}

function parseClassification(raw: string): PriorityClassification {
  const parsed = extractStructuredOutput<unknown>(raw, {
    label: "handoff-priority-classify",
  });
  if (!parsed || typeof parsed !== "object") {
    throw new Error("parsed payload is not an object");
  }
  const obj = parsed as Record<string, unknown>;
  const priorityRaw = obj["priority"];
  const reasonRaw = obj["reason"];

  if (typeof priorityRaw !== "string" || !isHandoffPriority(priorityRaw)) {
    throw new Error(`invalid priority: ${String(priorityRaw)}`);
  }
  if (typeof reasonRaw !== "string" || reasonRaw.trim().length === 0) {
    throw new Error("reason missing or empty");
  }

  return {
    priority: priorityRaw,
    reason: reasonRaw.trim().slice(0, MAX_REASON_CHARS),
  };
}

function isHandoffPriority(value: string): value is HandoffPriority {
  return (
    value === "low" || value === "medium" || value === "high" || value === "urgent"
  );
}
