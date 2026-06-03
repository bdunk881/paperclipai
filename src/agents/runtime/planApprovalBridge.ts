/**
 * Plan-mode → approvals bridge.
 *
 * When `executeAgentPrompt` is called with `permissionMode: "plan"`,
 * the agent produces a plan and stops without executing any tools. To
 * actually run the plan we need a human to sign off. Today that
 * involves manual replay; this bridge wires the round-trip so the
 * dashboard's existing approvals surface drives the whole loop:
 *
 *   1. Plan-mode run completes → `filePlanApprovalRequest()` stores
 *      the plan + original prompt as an `approval_requests` row.
 *   2. A reviewer hits the existing `POST /api/approvals/:id/decide`
 *      endpoint to approve / reject.
 *   3. `planApprovalResumeCoordinator` (sibling module) periodically
 *      sweeps for approved plan rows and calls `resumeApprovedPlan()`,
 *      which re-runs the agent with `permissionMode: "auto"` plus the
 *      approved plan folded into the system prompt.
 *
 * Storage strategy: the existing `approval_requests` table doesn't
 * have a JSONB column, so we encode the plan + original prompt into
 * the `message` field with a deterministic delimiter. A future
 * migration could promote this to a structured column, but the
 * encoding lets us ship without a schema change.
 */

import type { Pool } from "pg";

import { approvalStore } from "../../engine/approvalStore";

/**
 * Template name we stamp on approval rows that represent a plan-mode
 * pause. The existing approval-resume coordinator only acts on rows
 * whose template_name maps to a registered workflow; this name is
 * deliberately distinct so the workflow path ignores us, and our own
 * coordinator only looks at rows with this template name.
 */
export const PLAN_APPROVAL_TEMPLATE_NAME = "__autoflow_plan_approval__";

const MESSAGE_DELIMITER = "\n\n---ORIGINAL_PROMPT---\n\n";
const DEFAULT_TIMEOUT_MINUTES = 60 * 24; // 1 day

export interface FilePlanApprovalInput {
  workspaceId: string;
  userId: string;
  agentId: string;
  agentName: string;
  /** The runs.id that produced the plan. */
  runId: string;
  /** The prompt the user originally sent (the agent's userPrompt). */
  originalPrompt: string;
  /** The plan text the agent produced. */
  planText: string;
  /** Optional timeout in minutes. Defaults to 1 day. */
  timeoutMinutes?: number;
}

export interface ParsedPlanApprovalMessage {
  planText: string;
  originalPrompt: string;
}

/**
 * Persist a plan-mode pause as an `approval_requests` row. Returns
 * the approval ID so the caller can surface it to the user.
 */
export async function filePlanApprovalRequest(
  input: FilePlanApprovalInput,
): Promise<{ approvalId: string }> {
  const message = encodePlanApprovalMessage({
    planText: input.planText,
    originalPrompt: input.originalPrompt,
  });

  const { id } = await approvalStore.create({
    runId: input.runId,
    templateName: PLAN_APPROVAL_TEMPLATE_NAME,
    stepId: input.runId,
    stepName: `Approve plan for ${input.agentName}`,
    assignee: input.userId,
    message,
    timeoutMinutes: input.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES,
    userId: input.userId,
    agentId: input.agentId,
    workspaceId: input.workspaceId,
  });

  return { approvalId: id };
}

/**
 * Encode plan + original prompt into the approval's `message` field.
 * The reviewer surface today shows `message` as markdown, so the plan
 * is at the top and the delimiter + original prompt follow.
 */
export function encodePlanApprovalMessage(input: {
  planText: string;
  originalPrompt: string;
}): string {
  return `${input.planText}${MESSAGE_DELIMITER}${input.originalPrompt}`;
}

/**
 * Reverse of `encodePlanApprovalMessage`. Returns the raw text when
 * the delimiter is absent (legacy rows or hand-edited messages).
 */
export function parsePlanApprovalMessage(message: string): ParsedPlanApprovalMessage {
  const idx = message.indexOf(MESSAGE_DELIMITER);
  if (idx === -1) {
    return { planText: message, originalPrompt: "" };
  }
  return {
    planText: message.slice(0, idx),
    originalPrompt: message.slice(idx + MESSAGE_DELIMITER.length),
  };
}

/**
 * Look up an approved plan-mode approval row and re-run the agent with
 * the approved plan folded into its system prompt. Called by the
 * planApprovalResumeCoordinator sweep. Best-effort — failures log and
 * move on so a single bad row doesn't wedge the coordinator.
 */
export async function resumeApprovedPlan(input: {
  pool: Pool;
  approvalId: string;
  /**
   * Optional injection point for tests — defaults to `runAgentTurn`
   * from `../runAgentTurn`. Dynamic-imported at call time to avoid the
   * circular-import problem (runAgentTurn doesn't import this module
   * but the rest of the agents/ surface does).
   */
  runAgentTurnFn?: typeof import("../runAgentTurn").runAgentTurn;
}): Promise<{ resumed: boolean; reason?: string }> {
  const approval = await approvalStore.get(input.approvalId);
  if (!approval) {
    return { resumed: false, reason: "approval_not_found" };
  }
  if (approval.status !== "approved") {
    return {
      resumed: false,
      reason: `approval status is ${approval.status}, not approved`,
    };
  }
  const { planText, originalPrompt } = parsePlanApprovalMessage(approval.message);

  // We need agent context to re-run. Resolve via the agent_id stamped
  // on the approval — there's no other way to reconstruct it.
  if (!approval.agentId) {
    return { resumed: false, reason: "approval missing agent_id" };
  }
  if (!approval.userId) {
    return { resumed: false, reason: "approval missing user_id" };
  }

  const agentRow = await input.pool
    .query<{
      workspace_id: string;
      name: string;
      role_key: string;
      instructions: string | null;
    }>(
      `SELECT workspace_id::text, name, role_key, instructions
         FROM agents
        WHERE id = $1::uuid
        LIMIT 1`,
      [approval.agentId],
    )
    .catch(() => ({ rows: [] }));
  if (agentRow.rows.length === 0) {
    return { resumed: false, reason: "agent_not_found" };
  }
  const agent = agentRow.rows[0]!;

  const baseSystem = agent.instructions?.trim() || `You are ${agent.name}, a ${agent.role_key}.`;
  const systemWithPlan = [
    baseSystem,
    "",
    "# APPROVED PLAN",
    "",
    "A human has reviewed and approved this plan. Execute the steps below — do not re-plan.",
    "",
    planText,
  ].join("\n");

  const runAgentTurn =
    input.runAgentTurnFn ??
    (await import("../runAgentTurn")).runAgentTurn;

  try {
    await runAgentTurn({
      pool: input.pool,
      workspaceId: agent.workspace_id,
      userId: approval.userId,
      agentId: approval.agentId,
      agentName: agent.name,
      agentRoleKey: agent.role_key,
      systemPrompt: systemWithPlan,
      userPrompt: originalPrompt || "Execute the approved plan.",
      tier: "standard",
      streamTrace: true,
      permissionMode: "auto",
    });
    return { resumed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { resumed: false, reason: `resume_failed: ${message}` };
  }
}
