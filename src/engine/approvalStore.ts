/**
 * In-memory approval store for HITL (Human-in-the-Loop) workflow steps.
 *
 * When the WorkflowEngine hits an "approval" step it calls approvalStore.create(),
 * which returns a Promise that resolves once a human approves or rejects (or the
 * timeout fires).  The engine awaits that promise, pausing the run until resolved.
 */

import { randomUUID } from "crypto";

export interface ApprovalRequest {
  id: string;
  runId: string;
  templateName: string;
  stepId: string;
  stepName: string;
  assignee: string;
  message: string;
  timeoutMinutes: number;
  requestedAt: string;
  status: "pending" | "approved" | "rejected" | "timed_out";
  resolvedAt?: string;
  comment?: string;
  userId?: string;
}

interface PendingEntry {
  request: ApprovalRequest;
  resolve: (result: { approved: boolean; comment?: string }) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

const store = new Map<string, PendingEntry>();

export const approvalStore = {
  /**
   * Register a new approval request and return a Promise that settles when
   * a human resolves it (or it times out).
   */
  create(params: {
    runId: string;
    templateName: string;
    stepId: string;
    stepName: string;
    assignee: string;
    message: string;
    timeoutMinutes: number;
    userId?: string;
  }): { id: string; promise: Promise<{ approved: boolean; comment?: string }> } {
    const id = randomUUID();

    const request: ApprovalRequest = {
      id,
      runId: params.runId,
      templateName: params.templateName,
      stepId: params.stepId,
      stepName: params.stepName,
      assignee: params.assignee,
      message: params.message,
      timeoutMinutes: params.timeoutMinutes,
      requestedAt: new Date().toISOString(),
      status: "pending",
      ...(params.userId !== undefined ? { userId: params.userId } : {}),
    };

    let resolveCallback!: (result: { approved: boolean; comment?: string }) => void;
    const promise = new Promise<{ approved: boolean; comment?: string }>((res) => {
      resolveCallback = res;
    });

    const timeoutMs = params.timeoutMinutes * 60 * 1000;
    const timeoutHandle = setTimeout(() => {
      const entry = store.get(id);
      if (entry && entry.request.status === "pending") {
        entry.request.status = "timed_out";
        entry.request.resolvedAt = new Date().toISOString();
        resolveCallback({ approved: false });
      }
    }, timeoutMs);

    store.set(id, { request, resolve: resolveCallback, timeoutHandle });
    return { id, promise };
  },

  get(id: string): ApprovalRequest | undefined {
    return store.get(id)?.request;
  },

  list(status?: ApprovalRequest["status"], userId?: string): ApprovalRequest[] {
    let all = Array.from(store.values()).map((e) => e.request);
    if (status) all = all.filter((r) => r.status === status);
    if (userId) all = all.filter((r) => r.userId === userId);
    return all.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
  },

  /**
   * Resolve an approval request (approve or reject).
   * Returns false if the request is not found or already resolved.
   */
  resolve(
    id: string,
    decision: "approved" | "rejected",
    comment?: string
  ): boolean {
    const entry = store.get(id);
    if (!entry || entry.request.status !== "pending") return false;
    clearTimeout(entry.timeoutHandle);
    entry.request.status = decision;
    entry.request.resolvedAt = new Date().toISOString();
    if (comment) entry.request.comment = comment;
    entry.resolve({ approved: decision === "approved", comment });
    return true;
  },

  clear(): void {
    store.clear();
  },
};
