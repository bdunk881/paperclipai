import type { WorkflowTemplate, WorkflowRun } from "../types/workflow";

export const MOCK_TEMPLATES: WorkflowTemplate[] = [];

export const MOCK_RUNS: WorkflowRun[] = [];

export function generateRunId(): string {
  return `run-${String(Date.now()).slice(-6)}`;
}
