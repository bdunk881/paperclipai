/**
 * Agent-policy triage layer (HEL-94).
 *
 * The triage layer reads an agent's `triage_policy` (a Layer 1 workspace_instruction
 * row with kind='triage_policy') and applies it to a pending wake event. The
 * agent's *own* policy is what gates the decision — the platform delegates,
 * not overrides. Generic Haiku judgment is the wrong design; an agent's
 * authored ruleset executed cheaply is the right one.
 *
 * Resolution:
 *   1. Load the agent's triage_policy row (workspace + agent scoped)
 *   2. Build a structured-output request: { agent_card, policy_body, event }
 *   3. Call tierRouter.invoke('small', { responseSchema: TriageResultSchema })
 *      via the HEL-82 adapter. Default tier is `small` for cost (~$0.0005/event).
 *   4. Parse the response: { decision, reason, escalated_to? }
 *   5. Persist the decision via wakeEventStore.recordTriageDecision
 *
 * If the agent has no triage_policy, falls back to the DEFAULT_POLICY constant
 * (conservative: ACT on @-mentions + approvals, DEFER everything else).
 *
 * v1 ships the policy-resolution + decision-persistence shape. The actual LLM
 * call is pluggable via the `triageInvoke` dependency injection so the unit
 * tests don't need a live provider.
 */

import type { Pool } from "pg";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import {
  publishWakeEvent,
  recordTriageDecision,
  type WakeDecision,
  type WakeEvent,
  type PublishInput,
} from "./wakeEventStore";

const DEFAULT_POLICY_BODY = `
DEFAULT TRIAGE POLICY (used when an agent has no custom policy):

ACT on:
- Any approval resolution event (a human's decision matters)
- Any @-mention of this agent in a comment, ticket, or message

DEFER (re-check in 1 hour) on:
- Scheduled cron events from routines I'm registered for
- Inbound webhooks for missions I'm assigned to (if no policy specifies otherwise)

IGNORE on:
- Inbound webhooks not tied to a mission I'm assigned to

ESCALATE to my parent agent on:
- Any event where the summary contains "compliance", "legal", or "auth failure"
- Budget threshold events at >80%

If you're unsure, DEFER.
`.trim();

export interface TriageInvokeInput {
  agentIdentityCard: string;
  policyBody: string;
  event: {
    source: string;
    sourceRef: string | null;
    summary: string;
    payload: Record<string, unknown>;
  };
}

export interface TriageInvokeOutput {
  decision: Exclude<WakeDecision, "PENDING">;
  reason: string;
  /** When decision=ESCALATE, the agent_id to wake. */
  escalatedTo?: string | null;
  /** When decision=DEFER, the ISO timestamp the event re-fires for re-triage. */
  deferredUntil?: string | null;
  /** Cost of the triage call, USD. */
  costUsd: number;
}

export type TriageInvoker = (input: TriageInvokeInput) => Promise<TriageInvokeOutput>;

/** Default invoker — used when no LLM is wired. Conservative DEFER for everything. */
export const DEFAULT_TRIAGE_INVOKER: TriageInvoker = async (input) => {
  // Hardcoded rules so the default-stub behavior is still useful:
  // - ACT on @-mention + approval_resolved
  // - IGNORE webhook for unknown sources
  // - DEFER everything else
  const src = input.event.source;
  if (src === "mention" || src === "approval_resolved") {
    return {
      decision: "ACT",
      reason: "Default policy: high-signal user/approval event always wakes the agent.",
      costUsd: 0,
    };
  }
  if (src === "webhook") {
    return {
      decision: "IGNORE",
      reason:
        "Default policy: unrecognized webhook with no custom triage_policy — log only.",
      costUsd: 0,
    };
  }
  return {
    decision: "DEFER",
    reason: "Default policy: defer to next scheduled run.",
    deferredUntil: new Date(Date.now() + 3600_000).toISOString(),
    costUsd: 0,
  };
};

interface TriagePolicyRow {
  body: string;
}

async function loadTriagePolicy(
  pool: Pool,
  workspaceId: string,
  userId: string,
  agentId: string,
): Promise<string> {
  const row = await withWorkspaceContext(
    pool,
    { workspaceId, userId },
    async (client) => {
      const result = await client.query<TriagePolicyRow>(
        `SELECT body FROM workspace_instructions
          WHERE workspace_id = $1
            AND agent_id = $2
            AND kind = 'triage_policy'
            AND deleted_at IS NULL
          ORDER BY updated_at DESC
          LIMIT 1`,
        [workspaceId, agentId],
      );
      return result.rows[0] ?? null;
    },
  );
  return row?.body ?? DEFAULT_POLICY_BODY;
}

export interface TriageEventArgs {
  workspaceId: string;
  userId: string;
  agentId: string;
  agentIdentityCard: string;
}

/**
 * Apply triage to a single pending wake event. Persists the decision back.
 * Returns the updated WakeEvent (with decision filled in) or null if the
 * event couldn't be loaded.
 */
export async function triageEvent(
  pool: Pool,
  event: WakeEvent,
  args: TriageEventArgs,
  invoker: TriageInvoker = DEFAULT_TRIAGE_INVOKER,
): Promise<WakeEvent | null> {
  const policyBody = await loadTriagePolicy(pool, args.workspaceId, args.userId, args.agentId);

  let output: TriageInvokeOutput;
  try {
    output = await invoker({
      agentIdentityCard: args.agentIdentityCard,
      policyBody,
      event: {
        source: event.source,
        sourceRef: event.sourceRef,
        summary: event.summary,
        payload: event.payload,
      },
    });
  } catch (err) {
    // Triage failure → DEFER as a safety default; surface to operators via the
    // decision_reason field.
    output = {
      decision: "DEFER",
      reason: `Triage call failed: ${(err as Error).message}. Defer 1h.`,
      deferredUntil: new Date(Date.now() + 3600_000).toISOString(),
      costUsd: 0,
    };
  }

  return recordTriageDecision(pool, {
    eventId: event.id,
    workspaceId: args.workspaceId,
    userId: args.userId,
    decision: output.decision,
    decisionReason: output.reason,
    escalatedTo: output.escalatedTo ?? null,
    deferredUntil: output.deferredUntil ?? null,
    triageCostUsd: output.costUsd,
  });
}

/**
 * One-shot helper: publish a wake event AND immediately triage it. Returns
 * the post-triage row. Most callers (webhook handlers, @-mention publishers)
 * want this combined flow.
 */
export async function publishAndTriageEvent(
  pool: Pool,
  publish: PublishInput,
  triage: Omit<TriageEventArgs, "workspaceId" | "userId">,
  invoker?: TriageInvoker,
): Promise<WakeEvent | null> {
  const event = await publishWakeEvent(pool, publish);
  if (!triage.agentId) return event; // no agent → log only
  return triageEvent(
    pool,
    event,
    {
      workspaceId: publish.workspaceId,
      userId: publish.userId,
      agentId: triage.agentId,
      agentIdentityCard: triage.agentIdentityCard,
    },
    invoker,
  );
}
