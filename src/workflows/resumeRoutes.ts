/**
 * Webhook-resume endpoint for paused Wait steps (HEL-774).
 *
 *   POST /api/runs/resume/:token
 *
 * A `wait` step in `mode: "webhook"` pauses its run indefinitely behind a
 * one-time resume token (see WorkflowEngine._pauseForWebhookResume). An
 * external system POSTs to this endpoint to wake the run: the JSON body merges
 * into the run context (tenancy/engine-internal keys are protected), the token
 * is consumed, and the run re-enters the normal resume-from-step path.
 *
 * Public by design (like /api/forms and webhook URLs): the token is an
 * unguessable one-time bearer secret minted by the engine, and the resume
 * always executes in the run's OWN persisted workspace — nothing the caller
 * sends can change tenancy. Mounted WITHOUT auth, after express.json().
 *
 * NOTE: the engine is lazy-imported in the no-queue fallback only — a
 * top-level import would pull the ESM-only @mistralai transitive dep into this
 * module and break route tests (see backend-ci notes).
 */

import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { runStore } from "../engine/runStore";
import { getRunQueue, addRunJob } from "../queue/queues";
import { isJobIdAlreadyExists } from "../queue/bullMqJobId";
import { mergeResumePayload } from "../engine/waitStep";

const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createResumeRoutes(): Router {
  const router = Router();

  router.post(
    "/:token",
    asyncHandler(async (req, res) => {
      const token = req.params.token;
      if (!token || !TOKEN_RE.test(token)) {
        res.status(404).json({ error: "resume_token_not_found" });
        return;
      }

      const run = await runStore.getByResumeToken(token);
      const runtimeState = run?.runtimeState;
      if (!run || !runtimeState || runtimeState.waitingResumeToken !== token) {
        // Unknown or already-consumed token — indistinguishable on purpose.
        res.status(404).json({ error: "resume_token_not_found" });
        return;
      }

      // Merge the caller's payload into the paused context (clobber-guarded)
      // and consume the token — one update, so a concurrent second POST loses.
      const resumeStepIndex = runtimeState.currentStepIndex;
      await runStore.update(run.id, {
        runtimeState: {
          ...runtimeState,
          context: mergeResumePayload(runtimeState.context, req.body),
          waitingResumeToken: undefined,
        },
      });

      const runQueue = getRunQueue();
      if (runQueue) {
        const idempotencyKey = `${run.id}:${resumeStepIndex}:webhook-resume`;
        try {
          await addRunJob(
            runQueue,
            "run",
            {
              runId: run.id,
              templateId: run.templateId,
              ...(run.workflowVersionId ? { workflowVersionId: run.workflowVersionId } : {}),
              workspaceId: run.workspaceId ?? "",
              stepIndex: resumeStepIndex,
              idempotencyKey,
              // HEL-700: preserve the paused run's priority across the resume.
              priority: runtimeState.priority,
            },
            { jobId: `${run.id}:webhook-resume:${resumeStepIndex}`, removeOnComplete: 100 },
          );
        } catch (err) {
          if (!isJobIdAlreadyExists(err)) {
            throw err;
          }
        }
      } else {
        // No queue (local/dev without Redis): resume inline, best-effort. The
        // engine owns the running→terminal transitions and failure marking.
        const { workflowEngine } = await import("../engine/WorkflowEngine");
        void workflowEngine.executeQueuedRun(run.id, resumeStepIndex).catch((err) => {
          console.error(
            `[runs/resume] inline resume failed run=${run.id}: ${(err as Error).message}`,
          );
        });
      }

      res.status(202).json({ runId: run.id, resumedAtStepIndex: resumeStepIndex });
    }),
  );

  return router;
}
