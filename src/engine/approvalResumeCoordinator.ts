import { getTemplate } from "../templates";
import { runStore } from "./runStore";
import { approvalStore } from "./approvalStore";
import { workflowEngine } from "./WorkflowEngine";

const activeResumes = new Set<string>();
let resumeSweepTimer: ReturnType<typeof setInterval> | undefined;

export async function runApprovalResumeSweep(): Promise<{
  scanned: number;
  resumed: number;
  skippedPending: number;
  skippedMissingSnapshot: number;
}> {
  const runs = await runStore.list();
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
      template = getTemplate(run.templateId);
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

  return {
    scanned: awaitingRuns.length,
    resumed,
    skippedPending,
    skippedMissingSnapshot,
  };
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
