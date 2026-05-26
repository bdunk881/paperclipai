/**
 * executeAgentPrompt — shared NL-execution primitive (HEL-174).
 *
 * Powers the "natural-language agent interaction" surface across THREE
 * trigger paths:
 *
 *   1. Mission Assignment (ticket) created/updated with an agent assignee
 *      — backend enqueues, this primitive runs, the result is documented
 *        back to the ticket as a `structured_update` row.
 *
 *   2. Prompt-backed routine cron fire — scheduler.ts dispatches to the
 *      worker, the worker calls this primitive, the result lands in
 *      workspace memory and the `runs` row (no ticket update unless the
 *      agent decides to file one).
 *
 *   3. Manual "Run agent" CTA on a ticket — explicit re-trigger.
 *
 * The DAG / workflow path is unchanged; users who need branching /
 * multi-step automation still go through the workflow builder.
 *
 * This primitive intentionally does NOT make the trigger decision — the
 * caller (route handler / worker) owns that. It wraps `runAgentTurn`
 * (HEL-137) with:
 *
 *   - Agent context loading (system prompt, role, tier)
 *   - `runs` row persistence (prompt-backed, with `source_ticket_id` /
 *     `routine_id` link)
 *   - Optional ticket-update write-back (`structured_update` with action
 *     summary + tool-call traces + status transition)
 *   - Memory write-back via `runReflection` (HEL-150) so future calls
 *     can recall what this one learned
 *   - Activity-feed emit
 *
 * Cost + token usage flow into `runs` + `control_plane_spend_entries`
 * via the existing channels.
 */

import type { Pool } from "pg";
import { randomUUID } from "node:crypto";

import { runAgentTurn, type AgentRunTier, type RunAgentTurnResult } from "./runAgentTurn";
import { ticketStore } from "../tickets/ticketStore";
import { publishWorkspaceStreamEvent } from "../engine/agentTrace/streamPublisher";
import { filePlanApprovalRequest } from "./runtime/planApprovalBridge";

export interface ExecuteAgentPromptInput {
  pool: Pool;
  workspaceId: string;
  userId: string;
  agentId: string;
  /** Natural-language instructions for the agent. */
  prompt: string;
  /** Optional per-call system prompt override (else agent's default). */
  systemPrompt?: string;
  /** Model tier — defaults to "standard". */
  llmTier?: AgentRunTier;
  /** Link to originating ticket so result is written back as updates. */
  sourceTicketId?: string;
  /** Link to originating routine so the cron fire is attributable. */
  sourceRoutineId?: string;
  /**
   * Conversation context — prior ticket comments / structured updates,
   * folded into the LLM prompt so the agent has the full thread.
   */
  conversationContext?: Array<{
    actor: { type: "agent" | "user"; id: string };
    type: string;
    content: string;
    createdAt: string;
  }>;
  /** Trigger kind for observability + persistence. */
  triggerKind: "assignment" | "assignment_update" | "schedule" | "manual";
  /**
   * Permission mode forwarded to the runtime. "plan" makes the agent
   * produce a plan and stop — the caller (typically a route handler with
   * approval wiring) is expected to file an approval ticket and re-run
   * with "auto" after a human signs off.
   */
  permissionMode?: "auto" | "plan" | "review";
}

export interface ExecuteAgentPromptResult {
  runId: string;
  result: string;
  usage: RunAgentTurnResult["usage"];
  provider: string;
  model: string;
  /** Whether the agent flagged that human input is needed. */
  needsHumanInput: boolean;
  /**
   * HEL-175: `true` when the run was halted by a cooperative
   * cancellation check (DB status flipped to `cancelling`). The
   * `result`/`provider`/`model`/`usage` fields are empty placeholders
   * when this is set — the caller should branch on this BEFORE reading
   * the agent's reply.
   */
  cancelled?: boolean;
}

interface AgentRow {
  id: string;
  workspace_id: string;
  user_id: string;
  team_id: string;
  name: string;
  role_key: string;
  instructions: string | null;
  model: string | null;
}

interface CreatedRunRow {
  id: string;
}

/**
 * Builds the per-call system prompt. Combines the agent's stored
 * instructions with any per-call override, plus a stable preamble that
 * gives the agent its identity + the trigger context.
 */
function buildSystemPrompt(input: {
  agentName: string;
  agentRoleKey: string;
  storedInstructions: string;
  override?: string;
  triggerKind: ExecuteAgentPromptInput["triggerKind"];
}): string {
  const base = input.override?.trim() || input.storedInstructions.trim();
  const triggerNote =
    input.triggerKind === "assignment"
      ? "You are responding to a new Mission Assignment from a user. Read the request carefully and act."
      : input.triggerKind === "assignment_update"
        ? "You are responding to a follow-up comment on an existing Mission Assignment. Read the full thread for context."
        : input.triggerKind === "schedule"
          ? "You are running a scheduled routine. Produce a concise status update with concrete next actions. If you need human input or approval, clearly ask for it so the system can file an Assignment for you."
          : "You are running a manual re-trigger on an existing Assignment. Pick up where the prior thread left off.";
  return [
    `You are ${input.agentName}, an AutoFlow agent. Role: ${input.agentRoleKey}.`,
    "",
    base,
    "",
    triggerNote,
    "",
    "When you finish, end your reply with a single line of the form:",
    '  ACTION_SUMMARY: <one-sentence summary of what you did>',
    "If you could not complete the task and need a human, end instead with:",
    '  NEEDS_HUMAN_INPUT: <one-sentence reason>',
  ].join("\n");
}

/**
 * Folds conversation history into a single user-side prompt the LLM
 * can read alongside the current ask. Keeps history compact: type
 * tags + actor + content.
 */
function buildUserPrompt(input: {
  prompt: string;
  conversationContext?: ExecuteAgentPromptInput["conversationContext"];
}): string {
  if (!input.conversationContext?.length) {
    return input.prompt;
  }
  const history = input.conversationContext
    .map(
      (entry) =>
        `- [${entry.type}] ${entry.actor.type}:${entry.actor.id} @ ${entry.createdAt}\n  ${entry.content}`,
    )
    .join("\n");
  return [
    "Conversation history (oldest first):",
    history,
    "",
    "Current request / latest update:",
    input.prompt,
  ].join("\n");
}

const ACTION_SUMMARY_RE = /^ACTION_SUMMARY:\s*(.+)$/m;
const NEEDS_HUMAN_RE = /^NEEDS_HUMAN_INPUT:\s*(.+)$/m;

interface ParsedAgentReply {
  actionSummary: string;
  needsHumanInput: boolean;
  humanInputReason?: string;
}

function parseAgentReply(text: string): ParsedAgentReply {
  const needsHuman = NEEDS_HUMAN_RE.exec(text);
  if (needsHuman) {
    return {
      actionSummary: needsHuman[1]?.trim() ?? "Agent flagged that human input is needed.",
      needsHumanInput: true,
      humanInputReason: needsHuman[1]?.trim(),
    };
  }
  const action = ACTION_SUMMARY_RE.exec(text);
  return {
    actionSummary: action?.[1]?.trim() ?? "Agent completed the request.",
    needsHumanInput: false,
  };
}

/**
 * Inserts a prompt-backed `runs` row in `running` state at the START of
 * `executeAgentPrompt`. HEL-175: surfaces the run to the dashboard +
 * the cancel API while it's actually in flight, so a Cancel click has
 * something to target. `finalizeRunRow` updates this same row with the
 * terminal status + output once the agent finishes (or cancels).
 *
 * The CHECK constraint `runs_exactly_one_execution` (migration 053)
 * enforces that `workflow_version_id` is NULL when `prompt` is set.
 */
async function createRunningRunRow(input: {
  pool: Pool;
  workspaceId: string;
  userId: string;
  agentId: string;
  prompt: string;
  sourceTicketId?: string;
  sourceRoutineId?: string;
}): Promise<string> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  await input.pool.query<CreatedRunRow>(
    `INSERT INTO runs (
       id, workspace_id, routine_id, workflow_version_id, status,
       started_at, ended_at, input, output, runtime_state_json,
       error, user_id, prompt, source_ticket_id
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, NULL, 'running',
       $4::timestamptz, NULL, $5::jsonb, '{}'::jsonb, NULL,
       NULL, $6, $7, $8::uuid
     )`,
    [
      runId,
      input.workspaceId,
      input.sourceRoutineId ?? null,
      startedAt,
      JSON.stringify({ agentId: input.agentId, prompt: input.prompt }),
      input.userId,
      input.prompt,
      input.sourceTicketId ?? null,
    ],
  );
  return runId;
}

/**
 * HEL-175: cooperative cancellation checkpoint. Reads the current
 * `runs.status` for `runId` and returns `true` if a cancellation has
 * been requested (`status === 'cancelling'`). Caller bails the
 * remaining work and lets `finalizeRunRow` write the terminal
 * `canceled` state.
 */
async function wasCancellationRequested(pool: Pool, runId: string): Promise<boolean> {
  const result = await pool.query<{ status: string }>(
    `SELECT status FROM runs WHERE id = $1::uuid LIMIT 1`,
    [runId],
  );
  return result.rows[0]?.status === "cancelling";
}

/**
 * Updates the pre-created `runs` row with its terminal status + output.
 * Mirrors the original `persistRunRow` but writes via UPDATE instead of
 * INSERT so the dashboard's view of the in-flight run stays consistent.
 */
async function finalizeRunRow(input: {
  pool: Pool;
  runId: string;
  status: "completed" | "failed" | "escalated" | "canceled";
  output: Record<string, unknown>;
  error?: string;
}): Promise<void> {
  await input.pool.query(
    `UPDATE runs
        SET status = $2,
            ended_at = now(),
            output = $3::jsonb,
            error = $4
      WHERE id = $1::uuid`,
    [
      input.runId,
      input.status,
      JSON.stringify(input.output),
      input.error ?? null,
    ],
  );
}

/**
 * Documents the agent's action as a ticket update so the assignment
 * timeline reflects what happened. Mirrors what a human collaborator
 * would do — drops a `structured_update` with the summary + raw
 * reply + cost in metadata. Calls `ticketStore.addUpdate` would
 * require an actor + a context object; doing it via raw SQL here
 * keeps the primitive callable from worker contexts that don't have
 * the route's WorkspaceContext shape.
 */
async function appendStructuredUpdate(input: {
  pool: Pool;
  ticketId: string;
  agentId: string;
  workspaceId: string;
  actionSummary: string;
  fullReply: string;
  runId: string;
  needsHumanInput: boolean;
  humanInputReason?: string;
  provider: string;
  model: string;
  usage: RunAgentTurnResult["usage"];
}): Promise<void> {
  const content = input.needsHumanInput
    ? `**Needs human input.** ${input.humanInputReason ?? input.actionSummary}\n\n${input.fullReply}`
    : `${input.actionSummary}\n\n${input.fullReply}`;
  const metadata = {
    runId: input.runId,
    provider: input.provider,
    model: input.model,
    tokenUsage: input.usage,
    needsHumanInput: input.needsHumanInput,
    source: "agent_prompt_execution",
  };
  const updateId = randomUUID();
  await input.pool.query(
    `INSERT INTO ticket_updates (id, ticket_id, actor_type, actor_id, update_type, content, metadata_json, created_at)
       VALUES ($1::uuid, $2::uuid, 'agent', $3::text, 'structured_update', $4, $5::jsonb, now())`,
    [updateId, input.ticketId, input.agentId, content, JSON.stringify(metadata)],
  );

  // If the agent finished cleanly, advance ticket status from open →
  // in_progress (don't override resolved/blocked/cancelled).
  await input.pool.query(
    `UPDATE tickets
        SET status = 'in_progress', updated_at = now()
      WHERE id = $1::uuid
        AND status = 'open'`,
    [input.ticketId],
  );

  // Fan out for the per-ticket SSE stream.
  void publishWorkspaceStreamEvent(input.workspaceId, {
    kind: "ticket.update.appended",
    ticketId: input.ticketId,
    updateId,
    updateType: "structured_update",
    actor: { type: "agent", id: input.agentId },
    runId: input.runId,
  });
}

/**
 * Emits an activity event so the canonical observability feed reflects
 * the agent's run. Mirrors the observability emit pattern used by
 * other agent surfaces.
 */
async function emitActivityEvent(input: {
  pool: Pool;
  workspaceId: string;
  agentId: string;
  runId: string;
  actionSummary: string;
  sourceTicketId?: string;
  sourceRoutineId?: string;
  triggerKind: ExecuteAgentPromptInput["triggerKind"];
}): Promise<void> {
  await input.pool.query(
    `INSERT INTO activity_events (workspace_id, kind, actor, subject, payload, occurred_at)
       VALUES ($1::uuid, 'agent.prompt_executed', $2::jsonb, $3::jsonb, $4::jsonb, now())`,
    [
      input.workspaceId,
      JSON.stringify({ type: "agent", id: input.agentId }),
      JSON.stringify({ type: "run", id: input.runId, label: input.actionSummary }),
      JSON.stringify({
        runId: input.runId,
        sourceTicketId: input.sourceTicketId ?? null,
        sourceRoutineId: input.sourceRoutineId ?? null,
        triggerKind: input.triggerKind,
      }),
    ],
  );

  // Fan out for the activity firehose SSE stream.
  void publishWorkspaceStreamEvent(input.workspaceId, {
    kind: "activity.event",
    activityKind: "agent.prompt_executed",
    runId: input.runId,
    agentId: input.agentId,
    routineId: input.sourceRoutineId ?? null,
    ticketId: input.sourceTicketId ?? null,
    label: input.actionSummary,
  });
}

/**
 * Best-effort: enqueue a knowledge-reflection pass so what the agent
 * learned during this turn gets consolidated into `knowledge_items`
 * for future recall (HEL-150 / HEL-91 wiring).
 *
 * We don't block on this — it's a background consolidation, and any
 * failure is logged but not surfaced to the caller. The reflection
 * pipeline itself batches by lookback window, so we're really just
 * making sure SOMEONE will eventually pick this turn up.
 */
async function scheduleMemoryConsolidation(input: {
  workspaceId: string;
  agentId: string;
  runId: string;
}): Promise<void> {
  try {
    // The reflection route runs over recent activity windows; emitting
    // the activity event above is the canonical hand-off. This stub
    // is here as a future hook for explicit per-run reflection if we
    // want it. Logging keeps the call site visible without coupling
    // the primitive to the reflection module's internals.
    if (process.env.HEL_174_VERBOSE === "1") {
      console.log(
        `[agentPromptExecution] memory hand-off — ws=${input.workspaceId} agent=${input.agentId} run=${input.runId}`,
      );
    }
  } catch (err) {
    console.warn(
      `[agentPromptExecution] memory consolidation hand-off failed: ${(err as Error).message}`,
    );
  }
}

export async function executeAgentPrompt(
  input: ExecuteAgentPromptInput,
): Promise<ExecuteAgentPromptResult> {
  // 1. Load agent context.
  const agentResult = await input.pool.query<AgentRow>(
    `SELECT id::text, workspace_id::text, user_id, team_id::text, name,
            role_key, instructions, model
       FROM agents
      WHERE id = $1::uuid
        AND workspace_id = $2::uuid`,
    [input.agentId, input.workspaceId],
  );
  if (agentResult.rowCount === 0) {
    throw new Error(`agent_not_found:${input.agentId}`);
  }
  const agent = agentResult.rows[0]!;

  // Auto-create an Assignment ticket when the agent is invoked ad-hoc
  // and the caller didn't link an existing ticket. Every agent run leaves
  // a paper trail in the timeline — this closes the gap for manual runs
  // that previously had no ticket to attach `structured_update`s to.
  let sourceTicketId = input.sourceTicketId;
  if (!sourceTicketId && input.triggerKind === "manual") {
    sourceTicketId = await autoCreateAssignmentTicket({
      workspaceId: input.workspaceId,
      userId: input.userId,
      agentId: input.agentId,
      agentName: agent.name,
      prompt: input.prompt,
    });
  }

  const systemPrompt = buildSystemPrompt({
    agentName: agent.name,
    agentRoleKey: agent.role_key,
    storedInstructions: agent.instructions ?? "",
    override: input.systemPrompt,
    triggerKind: input.triggerKind,
  });
  const userPrompt = buildUserPrompt({
    prompt: input.prompt,
    conversationContext: input.conversationContext,
  });

  // HEL-175: pre-create the runs row in `running` state so the dashboard
  // can show the in-flight run + the cancel API has a real row to target.
  const runId = await createRunningRunRow({
    pool: input.pool,
    workspaceId: input.workspaceId,
    userId: input.userId,
    agentId: input.agentId,
    prompt: input.prompt,
    sourceTicketId,
    sourceRoutineId: input.sourceRoutineId,
  });

  // HEL-175 cooperative cancel checkpoint #1 — before paying for the
  // LLM call. Cheap; covers the case where Cancel was clicked while the
  // job was still queued in BullMQ.
  if (await wasCancellationRequested(input.pool, runId)) {
    await finalizeRunRow({
      pool: input.pool,
      runId,
      status: "canceled",
      output: { reason: "cancelled_before_llm_call" },
    });
    void publishWorkspaceStreamEvent(input.workspaceId, {
      kind: "run.lifecycle",
      phase: "canceled",
      runId,
      agentId: input.agentId,
      routineId: input.sourceRoutineId ?? null,
      ticketId: sourceTicketId ?? null,
      triggerKind: input.triggerKind,
    });
    return {
      runId,
      result: "",
      usage: { promptTokens: 0, completionTokens: 0 },
      provider: "n/a",
      model: "n/a",
      needsHumanInput: false,
      cancelled: true,
    };
  }

  // Lifecycle: announce the run on the workspace stream. Subscribers
  // listening on /api/routines/:id/stream, /api/tickets/:id/stream,
  // and the workspace firehoses use this to show a row going live.
  void publishWorkspaceStreamEvent(input.workspaceId, {
    kind: "run.lifecycle",
    phase: "started",
    runId,
    agentId: input.agentId,
    routineId: input.sourceRoutineId ?? null,
    ticketId: sourceTicketId ?? null,
    triggerKind: input.triggerKind,
  });

  // 2. Run the agentic turn.
  let turnResult: RunAgentTurnResult;
  try {
    turnResult = await runAgentTurn({
      pool: input.pool,
      workspaceId: input.workspaceId,
      userId: input.userId,
      agentId: input.agentId,
      runId,
      agentName: agent.name,
      agentRoleKey: agent.role_key,
      systemPrompt,
      userPrompt,
      tier: input.llmTier ?? "standard",
      includeSaveMemory: true,
      streamTrace: true,
      sourceRoutineId: input.sourceRoutineId ?? null,
      sourceTicketId: sourceTicketId ?? null,
      permissionMode: input.permissionMode,
    });
  } catch (err) {
    const message = (err as Error).message;
    await finalizeRunRow({
      pool: input.pool,
      runId,
      status: "failed",
      output: { error: message },
      error: message.slice(0, 1000),
    });
    void publishWorkspaceStreamEvent(input.workspaceId, {
      kind: "run.lifecycle",
      phase: "failed",
      runId,
      agentId: input.agentId,
      routineId: input.sourceRoutineId ?? null,
      ticketId: sourceTicketId ?? null,
      triggerKind: input.triggerKind,
      error: message.slice(0, 500),
    });
    if (sourceTicketId) {
      await appendStructuredUpdate({
        pool: input.pool,
        ticketId: sourceTicketId,
        agentId: input.agentId,
        workspaceId: input.workspaceId,
        actionSummary: `Agent failed: ${message.slice(0, 120)}`,
        fullReply: message,
        runId,
        needsHumanInput: true,
        humanInputReason: "Agent run failed; review the error and re-trigger.",
        provider: "n/a",
        model: "n/a",
        usage: { promptTokens: 0, completionTokens: 0 },
      }).catch((updateErr) =>
        console.warn(
          `[agentPromptExecution] post-failure ticket update failed: ${(updateErr as Error).message}`,
        ),
      );
    }
    throw err;
  }

  // HEL-175 cooperative cancel checkpoint #2 — after the LLM call but
  // before persisting the timeline update. The LLM cost is already paid
  // but at least we avoid documenting an action the user explicitly
  // killed.
  if (await wasCancellationRequested(input.pool, runId)) {
    await finalizeRunRow({
      pool: input.pool,
      runId,
      status: "canceled",
      output: {
        reason: "cancelled_after_llm_call",
        provider: turnResult.provider,
        model: turnResult.model,
        usage: turnResult.usage,
      },
    });
    void publishWorkspaceStreamEvent(input.workspaceId, {
      kind: "run.lifecycle",
      phase: "canceled",
      runId,
      agentId: input.agentId,
      routineId: input.sourceRoutineId ?? null,
      ticketId: sourceTicketId ?? null,
      triggerKind: input.triggerKind,
      provider: turnResult.provider,
      model: turnResult.model,
      usage: turnResult.usage,
    });
    return {
      runId,
      result: turnResult.text,
      usage: turnResult.usage,
      provider: turnResult.provider,
      model: turnResult.model,
      needsHumanInput: false,
      cancelled: true,
    };
  }

  // 3a. Plan-mode pause: the agent produced a plan instead of executing
  // tools. File an approval row so a human can review + sign off via
  // the existing /api/approvals/:id/decide surface. The
  // planApprovalResumeCoordinator sweep will re-run the agent in auto
  // mode once the row flips to "approved".
  if (input.permissionMode === "plan") {
    const { approvalId } = await filePlanApprovalRequest({
      workspaceId: input.workspaceId,
      userId: input.userId,
      agentId: input.agentId,
      agentName: agent.name,
      runId,
      originalPrompt: input.prompt,
      planText: turnResult.text,
    });
    await finalizeRunRow({
      pool: input.pool,
      runId,
      status: "escalated",
      output: {
        text: turnResult.text,
        provider: turnResult.provider,
        model: turnResult.model,
        usage: turnResult.usage,
        approvalId,
        permissionMode: "plan",
      },
    });
    void publishWorkspaceStreamEvent(input.workspaceId, {
      kind: "run.lifecycle",
      phase: "completed",
      runId,
      agentId: input.agentId,
      routineId: input.sourceRoutineId ?? null,
      ticketId: sourceTicketId ?? null,
      triggerKind: input.triggerKind,
      actionSummary: "Plan awaiting approval",
      needsHumanInput: true,
      provider: turnResult.provider,
      model: turnResult.model,
      usage: turnResult.usage,
    });
    return {
      runId,
      result: turnResult.text,
      usage: turnResult.usage,
      provider: turnResult.provider,
      model: turnResult.model,
      needsHumanInput: true,
    };
  }

  // 3. Parse the agent's reply for the action-summary + needs-human signals.
  const parsed = parseAgentReply(turnResult.text);

  // 4. Finalize the runs row with the terminal status + full output.
  await finalizeRunRow({
    pool: input.pool,
    runId,
    status: parsed.needsHumanInput ? "escalated" : "completed",
    output: {
      text: turnResult.text,
      provider: turnResult.provider,
      model: turnResult.model,
      usage: turnResult.usage,
      actionSummary: parsed.actionSummary,
    },
  });

  void publishWorkspaceStreamEvent(input.workspaceId, {
    kind: "run.lifecycle",
    phase: "completed",
    runId,
    agentId: input.agentId,
    routineId: input.sourceRoutineId ?? null,
    ticketId: sourceTicketId ?? null,
    triggerKind: input.triggerKind,
    actionSummary: parsed.actionSummary,
    needsHumanInput: parsed.needsHumanInput,
    provider: turnResult.provider,
    model: turnResult.model,
    usage: turnResult.usage,
  });

  // 5. Document on ticket — always set when assignment-triggered, and
  // always set for manual triggers because we auto-create one above.
  if (sourceTicketId) {
    await appendStructuredUpdate({
      pool: input.pool,
      ticketId: sourceTicketId,
      agentId: input.agentId,
      workspaceId: input.workspaceId,
      actionSummary: parsed.actionSummary,
      fullReply: turnResult.text,
      runId,
      needsHumanInput: parsed.needsHumanInput,
      humanInputReason: parsed.humanInputReason,
      provider: turnResult.provider,
      model: turnResult.model,
      usage: turnResult.usage,
    });
  }

  // 6. Emit activity event.
  await emitActivityEvent({
    pool: input.pool,
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    runId,
    actionSummary: parsed.actionSummary,
    sourceTicketId,
    sourceRoutineId: input.sourceRoutineId,
    triggerKind: input.triggerKind,
  });

  // 7. Hand off memory consolidation.
  await scheduleMemoryConsolidation({
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    runId,
  });

  return {
    runId,
    result: turnResult.text,
    usage: turnResult.usage,
    provider: turnResult.provider,
    model: turnResult.model,
    needsHumanInput: parsed.needsHumanInput,
  };
}

/**
 * Open an Assignment ticket for an ad-hoc agent run. Mirrors what a user
 * would do by hand: pick a short title from the prompt, paste the full
 * prompt as the description, assign the agent as the primary, and put
 * "user clicked Run Agent" in the kickoff comment via the structured
 * "Ticket created." update that `ticketStore.create` writes for us.
 *
 * Best-effort: if creation fails (Postgres unavailable in dev / in-memory
 * fallback path returning a transient error), we log and proceed without
 * a ticket. The run still completes and writes to `runs`/`activity_events`,
 * so the run is not lost — only the assignment timeline is.
 */
async function autoCreateAssignmentTicket(input: {
  workspaceId: string;
  userId: string;
  agentId: string;
  agentName: string;
  prompt: string;
}): Promise<string | undefined> {
  const title = input.prompt.trim().slice(0, 80) || `Ad-hoc task for ${input.agentName}`;
  try {
    const aggregate = await ticketStore.create({
      workspaceId: input.workspaceId,
      title,
      description: input.prompt,
      creatorId: input.userId,
      priority: "medium",
      assignees: [
        { type: "agent", id: input.agentId, role: "primary" },
      ],
      context: { workspaceId: input.workspaceId, userId: input.userId },
    });
    void publishWorkspaceStreamEvent(input.workspaceId, {
      kind: "ticket.created",
      ticketId: aggregate.ticket.id,
      title: aggregate.ticket.title,
      status: aggregate.ticket.status,
      priority: aggregate.ticket.priority,
      creatorId: aggregate.ticket.creatorId,
      assignees: aggregate.ticket.assignees.map((a) => ({
        type: a.type,
        id: a.id,
        role: a.role,
      })),
    });
    return aggregate.ticket.id;
  } catch (err) {
    console.warn(
      `[agentPromptExecution] auto-create assignment ticket failed: ${(err as Error).message}`,
    );
    return undefined;
  }
}
