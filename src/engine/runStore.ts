/**
 * In-memory run store.
 * Stores WorkflowRun instances keyed by run ID.
 * Replace with a PostgreSQL-backed store for production (see ALT-30).
 */

import { WorkflowRun } from "../types/workflow";

const store = new Map<string, WorkflowRun>();

export const runStore = {
  create(run: WorkflowRun): WorkflowRun {
    store.set(run.id, run);
    return run;
  },

  get(id: string): WorkflowRun | undefined {
    return store.get(id);
  },

  update(id: string, patch: Partial<WorkflowRun>): WorkflowRun | undefined {
    const existing = store.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch };
    store.set(id, updated);
    return updated;
  },

  list(templateId?: string, userId?: string): WorkflowRun[] {
    let runs = Array.from(store.values());
    if (templateId) runs = runs.filter((r) => r.templateId === templateId);
    if (userId) runs = runs.filter((r) => r.userId === userId);
    return runs;
  },

  clear(): void {
    store.clear();
  },
};
