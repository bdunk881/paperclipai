import { randomUUID } from "crypto";
import { WorkflowStep } from "../types/workflow";

export const APPROVAL_TIER_ACTION_TYPES = [
  "spend_above_threshold",
  "contracts",
  "public_posts",
  "customer_facing_comms",
  "code_merges_to_prod",
] as const;

export const APPROVAL_TIER_MODES = [
  "auto_approve",
  "notify_only",
  "require_approval",
] as const;

export type ApprovalTierActionType = (typeof APPROVAL_TIER_ACTION_TYPES)[number];
export type ApprovalTierMode = (typeof APPROVAL_TIER_MODES)[number];

export interface ApprovalTierPolicy {
  id: string;
  workspaceId: string;
  actionType: ApprovalTierActionType;
  mode: ApprovalTierMode;
  spendThresholdCents?: number;
  createdAt: string;
  updatedAt: string;
}

export function isApprovalTierActionType(value: unknown): value is ApprovalTierActionType {
  return typeof value === "string" && APPROVAL_TIER_ACTION_TYPES.includes(value as ApprovalTierActionType);
}

export function isApprovalTierMode(value: unknown): value is ApprovalTierMode {
  return typeof value === "string" && APPROVAL_TIER_MODES.includes(value as ApprovalTierMode);
}

export function defaultApprovalTierPolicyForAction(
  workspaceId: string,
  actionType: ApprovalTierActionType,
): ApprovalTierPolicy {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    workspaceId,
    actionType,
    mode: "require_approval",
    spendThresholdCents: actionType === "spend_above_threshold" ? 0 : undefined,
    createdAt: now,
    updatedAt: now,
  };
}

export function defaultApprovalTierPoliciesForWorkspace(
  workspaceId: string,
): ApprovalTierPolicy[] {
  return APPROVAL_TIER_ACTION_TYPES.map((actionType) =>
    defaultApprovalTierPolicyForAction(workspaceId, actionType),
  );
}

const ACTION_TYPE_BY_ACTION_NAME: Record<string, ApprovalTierActionType> = {
  "finance.processInvoice": "spend_above_threshold",
  "contract.send": "contracts",
  "contract.execute": "contracts",
  "docusign.sendEnvelope": "contracts",
  "content.publish": "public_posts",
  "social.routeMention": "public_posts",
  "support.sendOrEscalate": "customer_facing_comms",
  "email.scheduleCampaign": "customer_facing_comms",
  "success.launchOnboarding": "customer_facing_comms",
  "github.mergePullRequest": "code_merges_to_prod",
  "github.mergeToProd": "code_merges_to_prod",
  "github.deployProduction": "code_merges_to_prod",
};

function getGovernanceConfig(step: WorkflowStep): Record<string, unknown> {
  const raw = step.config?.["governance"];
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

export function resolveApprovalTierActionType(
  step: WorkflowStep,
): ApprovalTierActionType | undefined {
  const governance = getGovernanceConfig(step);
  if (isApprovalTierActionType(governance["actionType"])) {
    return governance["actionType"];
  }

  if (!step.action) {
    return undefined;
  }

  return ACTION_TYPE_BY_ACTION_NAME[step.action];
}

function readNumericValue(
  source: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function resolveSpendAmountCents(
  step: WorkflowStep,
  context: Record<string, unknown>,
): number | undefined {
  const governance = getGovernanceConfig(step);
  const configuredKey =
    typeof governance["spendAmountCentsKey"] === "string"
      ? (governance["spendAmountCentsKey"] as string)
      : undefined;

  const candidateKeys = configuredKey
    ? [configuredKey]
    : ["spendAmountCents", "amountCents", "invoiceAmountCents", "totalCents"];

  for (const key of candidateKeys) {
    const value = readNumericValue(context, key);
    if (value !== undefined) {
      return value;
    }
  }

  if (typeof governance["spendAmountCents"] === "number") {
    return governance["spendAmountCents"] as number;
  }

  return undefined;
}
