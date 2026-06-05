/**
 * POST /api/mission-assignments/:id/replay (HEL-491).
 *
 * Re-dispatches the agent-prompt execution for a mission assignment — which is
 * a ticket with an agent assignee (`/api/mission-assignments` is the renamed
 * `/api/tickets`). Was a scaffold that always returned a fake `{ queued: true,
 * message: "Scaffold response." }` regardless of input; now it validates the
 * assignment exists, builds the same `AgentPromptJobPayload` the original
 * delivery used, enqueues a FRESH job, and returns the real job id.
 *
 * A replay must actually re-run, so it gets a non-deterministic job id +
 * idempotency key — not the prompt-hashed dedupe ids the create-time dispatch
 * (`dispatchAgentPromptForTicket`) uses, which would silently drop a duplicate.
 */
import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import { asyncHandler } from "../middleware/asyncHandler";
import { ticketStore } from "../tickets/ticketStore";
import { getAgentPromptQueue, type AgentPromptJobPayload } from "../queue/queues";
import { buildBullMqJobId, hashForJobIdSegment } from "../queue/bullMqJobId";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post(
  "/:id/replay",
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
    const userId = req.auth?.sub?.trim();
    const workspaceId = req.workspaceId?.trim();
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated workspace user is required" });
      return;
    }

    // FK lookup, scoped to the caller's workspace — replaying another tenant's
    // assignment resolves to not-found.
    const aggregate = await ticketStore.get(req.params.id, { workspaceId, userId });
    if (!aggregate) {
      res.status(404).json({ error: "Mission assignment not found" });
      return;
    }
    const { ticket } = aggregate;

    const agentAssignee =
      ticket.assignees.find((a) => a.type === "agent" && a.role === "primary") ??
      ticket.assignees.find((a) => a.type === "agent");
    if (!agentAssignee || !UUID_RE.test(agentAssignee.id)) {
      res.status(409).json({ error: "Mission assignment has no agent assignee to replay" });
      return;
    }

    const queue = getAgentPromptQueue();
    if (!queue) {
      // Mirror the create-time dispatch's stance (HEL-177): no silent inline
      // fallback — surface the queue misconfiguration instead of faking success.
      res.status(503).json({ error: "Agent execution queue is not configured" });
      return;
    }

    const nonce = randomUUID();
    const jobId = buildBullMqJobId("ticket", ticket.id, "replay", hashForJobIdSegment(nonce));
    const payload: AgentPromptJobPayload = {
      workspaceId: ticket.workspaceId,
      userId,
      agentId: agentAssignee.id,
      prompt: ticket.description,
      sourceTicketId: ticket.id,
      triggerKind: "manual",
      idempotencyKey: `replay:${ticket.id}:${nonce}`,
    };

    const job = await queue.add("manual", payload, { jobId });

    res.status(202).json({
      assignmentId: ticket.id,
      jobId: job.id ?? jobId,
      agentId: agentAssignee.id,
      status: "queued",
      queued: true,
    });
  }),
);

export default router;
