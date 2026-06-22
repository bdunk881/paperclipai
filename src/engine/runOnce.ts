/**
 * HEL-810 (parent HEL-807): one-shot run execution for an isolated Fly Machine.
 *
 * When the api image boots with `AUTOFLOW_RUN_ONCE=<runId>` (set by the
 * isolatedRunDispatcher), index.ts calls this instead of starting the HTTP
 * server: execute exactly that one run via the normal engine path, then the
 * caller exits with the mapped code. Persistence (run/step state) is written to
 * Postgres exactly as the inline worker does — no separate status channel.
 */

export interface RunOnceResult {
  ok: boolean;
  error?: string;
}

export async function executeRunOnce(runId: string, stepIndex = 0): Promise<RunOnceResult> {
  try {
    // Lazy import (mirrors worker.ts): WorkflowEngine statically pulls the
    // llmProviders barrel (ESM-only @mistralai), which breaks module-eval in
    // jest — deferring keeps run-once off that chain.
    const { workflowEngine } = await import("./WorkflowEngine");
    await workflowEngine.executeQueuedRun(runId, Number.isFinite(stepIndex) ? stepIndex : 0);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
