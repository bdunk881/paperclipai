/**
 * Agent self-check-in workflow (UX-12).
 *
 * Wave 5 shipped "Check in now" as: create a ticket, flip presence to
 * "checking-in", let the agent pick up the ticket on its next routine
 * cycle. That punted on the question of what the agent actually DOES
 * when checked in — and "next cycle" could be hours away.
 *
 * This module makes the check-in active: when the owner clicks
 * "Check in now", the API route fires this helper fire-and-forget,
 * which:
 *
 *   1. Reads the agent's open mission assignments (tickets).
 *   2. Calls the workspace's default LLM with the agent's name +
 *      role + assignment list and asks for a structured self-report:
 *        { state: "idle" | "working" | "blocked",
 *          summary: "<one short sentence>" }
 *   3. Writes the result back to agentPresence so the dashboard's
 *      live pill flips from "checking-in" → "{summary}" in real time
 *      via the SSE stream.
 *
 * Failures are swallowed (presence simply stays "checking-in" until
 * its 30s TTL lapses and the agent shows offline). The owner sees a
 * useful state OR an honest offline — never a stuck animation.
 */

import type { Pool } from "pg";
import * as Sentry from "@sentry/node";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { resolveModelForTier } from "../engine/llmRouter";
import { getProvider } from "../engine/llmProviders";
import { extractStructuredOutput } from "../engine/structuredOutput";
import { ticketStore } from "../tickets/ticketStore";
import {
  publishAgentTokenPreview,
  setAgentPresence,
  type AgentPresenceState,
} from "./agentPresence";

const SELF_CHECK_IN_TIMEOUT_MS = 45_000;
const MAX_TICKETS_IN_PROMPT = 8;
const MAX_SUMMARY_CHARS = 240;
/**
 * How long between token-preview publishes while the LLM streams.
 * Anthropic emits dozens of text deltas per second; debouncing to
 * ~5/s keeps Redis traffic + Cloudflare SSE bandwidth proportional
 * to what a human can actually read in the dashboard pill.
 */
const TOKEN_PREVIEW_PUBLISH_INTERVAL_MS = 200;
/**
 * Tail of the streamed assistant text we keep in the rolling preview.
 * The pill is one line; sending more than this is wasted bytes.
 */
const TOKEN_PREVIEW_TAIL_CHARS = 240;

interface SelfReport {
  state: AgentPresenceState;
  summary: string;
}

interface RunInput {
  pool: Pool;
  workspaceId: string;
  userId: string;
  agentId: string;
  agentName: string;
  agentRoleKey: string | null;
}

/**
 * Fire-and-forget. The route handler does NOT await this — the agent
 * presence pill is the user-facing feedback channel. Any error here
 * is logged + sentry-captured and presence stays at "checking-in"
 * until TTL.
 */
export function runAgentSelfCheckIn(input: RunInput): void {
  void executeSelfCheckIn(input).catch((err) => {
    console.warn(
      `[agentCheckIn] self check-in failed for ${input.agentName}: ${(err as Error).message}`,
    );
    Sentry.captureException(err, {
      tags: { route: "POST /api/agents/:agentId/check-in", phase: "self_review" },
      contexts: {
        agent: {
          workspaceId: input.workspaceId,
          agentId: input.agentId,
          agentName: input.agentName,
        },
      },
    });
  });
}

async function executeSelfCheckIn(input: RunInput): Promise<void> {
  const { pool, workspaceId, userId, agentId, agentName, agentRoleKey } = input;

  // Load the agent's open mission assignments to give the LLM real
  // context. We cap at 8 so a heavy queue doesn't blow up the prompt.
  let openTickets: Array<{ title: string; status: string; priority: string }> = [];
  try {
    const tickets = await ticketStore.list(
      { workspaceId, actorType: "agent", actorId: agentId },
      { workspaceId, userId },
    );
    openTickets = tickets
      .filter((t) => t.status === "open" || t.status === "in_progress" || t.status === "blocked")
      .slice(0, MAX_TICKETS_IN_PROMPT)
      .map((t) => ({
        title: t.title.slice(0, 120),
        status: t.status,
        priority: t.priority,
      }));
  } catch (err) {
    // Soft-fail: still run the self-check with an empty ticket list
    // so the agent at least gets a chance to report "all clear".
    console.warn(
      `[agentCheckIn] ticket lookup failed for ${agentName} (continuing with empty queue): ${(err as Error).message}`,
    );
  }

  const resolved = await llmConfigStore.getDecryptedDefault(userId);
  if (!resolved) {
    // Without an LLM provider the self-check can't run. Leave presence
    // as "checking-in" so it lapses to offline naturally. The route's
    // ticket-creation half still gives the user feedback.
    console.warn(
      `[agentCheckIn] no LLM provider configured; skipping self review for ${agentName}`,
    );
    return;
  }

  // HEL-146: Haiku tier. The check-in output contract is just
  // `{ state, summary }` with summary capped at MAX_SUMMARY_CHARS
  // (240) — Haiku handles this with no quality loss at ~12× lower
  // output cost than Sonnet. The button is clickable by every owner
  // of every agent, so the tier choice compounds across the install
  // base.
  const model = resolveModelForTier(resolved.config.provider, "lite");
  // Streaming token-preview wiring. Each text delta from the provider
  // updates `lastPreview`; a debounced publisher fans that out on the
  // workspace's token-preview Redis channel, which the dashboard's
  // SSE stream forwards into the agent pill in near real time.
  //
  // We DON'T pass onText when the provider call is in JSON-mode
  // (responseFormat: json_object) — the Anthropic provider falls
  // back to non-stream for forced tool-use anyway, but being explicit
  // avoids depending on that detail across providers. The check-in
  // self-report *is* JSON, so this code path currently never streams.
  // Leaving the streamer wired so a future "agent talks to owner"
  // free-text flow can opt in trivially.
  let lastPreview = "";
  let publishHandle: ReturnType<typeof setTimeout> | null = null;
  function schedulePublish(): void {
    if (publishHandle) return;
    publishHandle = setTimeout(() => {
      publishHandle = null;
      void publishAgentTokenPreview({
        workspaceId,
        agentId,
        preview: lastPreview,
      });
    }, TOKEN_PREVIEW_PUBLISH_INTERVAL_MS);
  }

  const provider = getProvider({
    provider: resolved.config.provider,
    model,
    apiKey: resolved.apiKey,
    responseFormat: { type: "json_object" },
    requestTimeoutMs: SELF_CHECK_IN_TIMEOUT_MS,
    onText: (_delta, accumulated) => {
      lastPreview = accumulated.slice(-TOKEN_PREVIEW_TAIL_CHARS);
      schedulePublish();
    },
  });

  const prompt = buildPrompt({ agentName, agentRoleKey, openTickets });
  const response = await provider(prompt);

  // Flush any pending preview so consumers see the final tail
  // immediately, then let the next setAgentPresence overwrite the
  // pill with the canonical state.
  if (publishHandle) {
    clearTimeout(publishHandle);
    publishHandle = null;
  }

  let report: SelfReport;
  try {
    report = parseReport(response.text);
  } catch (err) {
    console.warn(
      `[agentCheckIn] parse failed for ${agentName}: ${(err as Error).message}`,
    );
    return;
  }

  await setAgentPresence({
    workspaceId,
    agentId,
    state: report.state,
    currentTask: report.summary,
  });
}

/**
 * Hand-tuned prompt. The model returns a JSON object so the response
 * is easy to consume without a wrapping zod schema (we validate
 * shape in parseReport below).
 *
 * Exported for testability — the prompt content is half the
 * behavior here, so a regression test that asserts ticket titles +
 * agent role appear in the prompt is worth keeping.
 */
export function buildPrompt(input: {
  agentName: string;
  agentRoleKey: string | null;
  openTickets: Array<{ title: string; status: string; priority: string }>;
}): string {
  const role = input.agentRoleKey?.trim() || "operator";
  const queueLines =
    input.openTickets.length === 0
      ? "(no open mission assignments)"
      : input.openTickets
          .map(
            (t, i) =>
              `${i + 1}. "${t.title}" — ${t.status}, ${t.priority} priority`,
          )
          .join("\n");

  return [
    "You are an AutoFlow agent doing a quick self-check-in for your owner.",
    `Your name: ${input.agentName}.`,
    `Your role: ${role}.`,
    "",
    "Below is your current queue of mission assignments. Review them and respond.",
    "",
    "Open assignments:",
    queueLines,
    "",
    'Return JSON ONLY with this exact shape: { "state": "idle" | "working" | "blocked", "summary": "<one short sentence>" }',
    "",
    "Rules:",
    "- Use \"idle\" if there's nothing urgent or your queue is empty.",
    "- Use \"working\" if you're actively making progress on a queued assignment. Summary names the assignment.",
    "- Use \"blocked\" if something prevents you from progressing. Summary explains the blocker in one sentence.",
    `- Summary must be ≤ ${MAX_SUMMARY_CHARS} characters, plain text, no markdown.`,
    "- Do not invent assignments that aren't in the list.",
  ].join("\n");
}

function parseReport(raw: string): SelfReport {
  const parsed = extractStructuredOutput<unknown>(raw, { label: "agent-self-check-in" });
  if (!parsed || typeof parsed !== "object") {
    throw new Error("parsed payload is not an object");
  }
  const obj = parsed as Record<string, unknown>;
  const stateRaw = obj["state"];
  const summaryRaw = obj["summary"];

  if (typeof stateRaw !== "string" || !isPresenceState(stateRaw)) {
    throw new Error(`invalid state: ${String(stateRaw)}`);
  }
  if (typeof summaryRaw !== "string" || summaryRaw.trim().length === 0) {
    throw new Error("summary missing or empty");
  }

  return {
    state: stateRaw,
    summary: summaryRaw.trim().slice(0, MAX_SUMMARY_CHARS),
  };
}

function isPresenceState(value: string): value is AgentPresenceState {
  return value === "idle" || value === "working" || value === "blocked";
}
