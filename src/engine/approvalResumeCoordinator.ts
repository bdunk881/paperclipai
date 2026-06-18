import { getTemplate } from "../templates";
import { WorkflowTemplate, WorkflowRun } from "../types/workflow";
import { runStore } from "./runStore";
import { approvalStore } from "./approvalStore";
import { workflowEngine } from "./WorkflowEngine";
import { CoordinatorLockKey, runWithAdvisoryLock } from "./coordinatorLock";

const activeResumes = new Set<string>();
let resumeSweepTimer: ReturnType<typeof setInterval> | undefined;

async function resolveRunTemplateSnapshot(run: WorkflowRun): Promise<WorkflowTemplate> {
  if (
    run.workflowDag &&
    typeof run.workflowDag === "object" &&
    !Array.isArray(run.workflowDag) &&
    Array.isArray((run.workflowDag as Partial<WorkflowTemplate>).steps)
  ) {
    return run.workflowDag as WorkflowTemplate;
  }

  // Re-resolution of an already-owned run's DAG — scope to the run's workspace.
  return getTemplate(run.templateId, run.workspaceId);
}

export async function runApprovalResumeSweep(now: number = Date.now()): Promise<{
  scanned: number;
  resumed: number;
  timedOut: number;
  skippedPending: number;
  skippedMissingSnapshot: number;
}> {
  // B1/HEL-458: only one instance resumes per tick so the 2-machine fleet
  // can't double-resume a run — which would double-execute steps (duplicated
  // LLM spend + duplicated real-world side effects).
  let result = { scanned: 0, resumed: 0, timedOut: 0, skippedPending: 0, skippedMissingSnapshot: 0 };
  await runWithAdvisoryLock(CoordinatorLockKey.approvalResume, async () => {
    let runs;
    try {
      runs = await runStore.list();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[approval] Resume sweep skipped:", msg);
      return;
    }
    const awaitingRuns = runs.filter((run) => run.status === "awaiting_approval");

    let resumed = 0;
    let timedOut = 0;
    let skippedPending = 0;
    let skippedMissingSnapshot = 0;

    for (const run of awaitingRuns) {
      if (activeResumes.has(run.id)) {
        continue;
      }

      const approvalId = run.runtimeState?.waitingApprovalId;
      if (!approvalId) {
        skippedMissingSnapshot += 1;
        continue;
      }

      const approval = await approvalStore.get(approvalId);
      if (!approval) {
        skippedPending += 1;
        continue;
      }
      if (approval.status === "pending") {
        // HEL-697: durable timeout backstop. approvalStore.create arms the
        // timeout with an in-process setTimeout that is lost if that process
        // restarts — and now that the approval step parks the run instead of
        // blocking a worker on waitForDecision, nothing else fires the timeout.
        // Once the deadline (requestedAt + timeoutMinutes) passes, resolve
        // timed_out here so the run resumes into its failure path below; this is
        // DB-driven, so it survives a restart of whichever process created it.
        const deadlineMs =
          new Date(approval.requestedAt).getTime() + approval.timeoutMinutes * 60_000;
        if (!Number.isFinite(deadlineMs) || now < deadlineMs) {
          skippedPending += 1;
          continue;
        }
        await approvalStore.resolve(approvalId, "timed_out");
        timedOut += 1;
      }

      let template;
      try {
        template = await resolveRunTemplateSnapshot(run);
      } catch {
        skippedMissingSnapshot += 1;
        continue;
      }

      activeResumes.add(run.id);
      try {
        await workflowEngine.resumeRun(run.id, template);
        resumed += 1;
      } finally {
        activeResumes.delete(run.id);
      }
    }

    result = {
      scanned: awaitingRuns.length,
      resumed,
      timedOut,
      skippedPending,
      skippedMissingSnapshot,
    };
  });
  return result;
}

export function startApprovalResumeCoordinator(intervalMs = 2_000): void {
  if (resumeSweepTimer) {
    return;
  }

  resumeSweepTimer = setInterval(() => {
    void runApprovalResumeSweep().catch((error) => {
      console.error("Approval resume sweep failed", error);
    });
  }, intervalMs);

  resumeSweepTimer.unref?.();
}

export function stopApprovalResumeCoordinator(): void {
  if (!resumeSweepTimer) {
    return;
  }

  clearInterval(resumeSweepTimer);
  resumeSweepTimer = undefined;
}
