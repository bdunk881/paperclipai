import { getTemplate } from "../templates";
import { WorkflowTemplate, WorkflowRun } from "../types/workflow";
import { runStore } from "./runStore";
import { approvalStore } from "./approvalStore";
import { workflowEngine } from "./WorkflowEngine";
import { CoordinatorLockKey, runWithAdvisoryLock } from "./coordinatorLock";

const activeResumes = new Set<string>();
let resumeSweepTimer: ReturnType<typeof setInterval> | undefined;

function resolveRunTemplateSnapshot(run: WorkflowRun): WorkflowTemplate {
  if (
    run.workflowDag &&
    typeof run.workflowDag === "object" &&
    !Array.isArray(run.workflowDag) &&
    Array.isArray((run.workflowDag as Partial<WorkflowTemplate>).steps)
  ) {
    return run.workflowDag as WorkflowTemplate;
  }

  return getTemplate(run.templateId);
}

export async function runApprovalResumeSweep(): Promise<{
  scanned: number;
  resumed: number;
  skippedPending: number;
  skippedMissingSnapshot: number;
}> {
  // B1/HEL-458: only one instance resumes per tick so the 2-machine fleet
  // can't double-resume a run — which would double-execute steps (duplicated
  // LLM spend + duplicated real-world side effects).
  let result = { scanned: 0, resumed: 0, skippedPending: 0, skippedMissingSnapshot: 0 };
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
      if (!approval || approval.status === "pending") {
        skippedPending += 1;
        continue;
      }

      let template;
      try {
        template = resolveRunTemplateSnapshot(run);
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
