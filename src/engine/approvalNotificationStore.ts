import { randomUUID } from "crypto";

export type ApprovalNotificationStatus = "sent";

export interface ApprovalNotificationRecord {
  id: string;
  approvalId: string;
  runId: string;
  templateId: string;
  templateName: string;
  stepId: string;
  stepName: string;
  assignee: string;
  message: string;
  channel: "in_app";
  status: ApprovalNotificationStatus;
  createdAt: string;
  sentAt: string;
}

const notifications = new Map<string, ApprovalNotificationRecord>();

function makeKey(approvalId: string, assignee: string): string {
  return `${approvalId}:${assignee}`;
}

export const approvalNotificationStore = {
  publish(params: {
    approvalId: string;
    runId: string;
    templateId: string;
    templateName: string;
    stepId: string;
    stepName: string;
    assignees: string[];
    message: string;
  }): ApprovalNotificationRecord[] {
    const timestamp = new Date().toISOString();

    return params.assignees.map((assignee) => {
      const key = makeKey(params.approvalId, assignee);
      const record: ApprovalNotificationRecord = {
        id: notifications.get(key)?.id ?? randomUUID(),
        approvalId: params.approvalId,
        runId: params.runId,
        templateId: params.templateId,
        templateName: params.templateName,
        stepId: params.stepId,
        stepName: params.stepName,
        assignee,
        message: params.message,
        channel: "in_app",
        status: "sent",
        createdAt: notifications.get(key)?.createdAt ?? timestamp,
        sentAt: timestamp,
      };
      notifications.set(key, record);
      return record;
    });
  },

  list(filters?: {
    assignee?: string;
    approvalId?: string;
    runId?: string;
  }): ApprovalNotificationRecord[] {
    let all = Array.from(notifications.values());

    if (filters?.assignee) {
      all = all.filter((record) => record.assignee === filters.assignee);
    }
    if (filters?.approvalId) {
      all = all.filter((record) => record.approvalId === filters.approvalId);
    }
    if (filters?.runId) {
      all = all.filter((record) => record.runId === filters.runId);
    }

    return all.sort(
      (left, right) => new Date(right.sentAt).getTime() - new Date(left.sentAt).getTime()
    );
  },

  clear(): void {
    notifications.clear();
  },
};
