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

// Default spend-trigger threshold: $500. A bare 0 here used to leak
// into the dashboard as a confusing "Spend over $0" display.
// $500 matches the dashboard editor's default value and reads as an
// intentional, conservative starting point for new workspaces.
export const DEFAULT_SPEND_THRESHOLD_CENTS = 50_000;

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
    spendThresholdCents:
      actionType === "spend_above_threshold"
        ? DEFAULT_SPEND_THRESHOLD_CENTS
        : undefined,
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

/** The engine action id for a Composio tool execution (connectorActions/composioActions, HEL-753). */
export const COMPOSIO_EXECUTE_ACTION = "composio.execute";

/**
 * Best-effort governance tier for a Composio tool, derived from its slug (HEL-754).
 *
 * Composio exposes 1000s of tools, so we can't enumerate them like the curated
 * native `ACTION_TYPE_BY_ACTION_NAME` map. Instead we map the unambiguous
 * HIGH-RISK action verbs in a slug to a tier — a conservative SAFETY NET so a
 * Composio write that pays / signs / merges / publishes / messages doesn't
 * execute ungoverned. Reads/lookups are never gated. An explicit
 * `step.config.governance.actionType` always overrides this (set by mission/team
 * generation, P5). Anything unmatched stays ungoverned, exactly like an unmapped
 * native action — this nets the obvious dangerous writes; it is not a complete
 * per-tool policy (full toolkit curation is future work).
 */
export function composioTierFromSlug(slug: string): ApprovalTierActionType | undefined {
  const s = slug.toUpperCase();
  // Reads / lookups never need approval (checked first so e.g. LIST_INVOICES,
  // GET_PAYMENT don't trip the spend net below).
  if (/(^|_)(GET|FETCH|LIST|SEARCH|RETRIEVE|READ|FIND|DOWNLOAD|EXPORT)(_|$)/.test(s)) {
    return undefined;
  }
  if (/PAYMENT|PAYOUT|REFUND|TRANSFER|WIRE|CHARGE|INVOICE/.test(s)) return "spend_above_threshold";
  if (/ENVELOPE|SIGNATURE|CONTRACT/.test(s)) return "contracts";
  if (/MERGE|DEPLOY|RELEASE/.test(s)) return "code_merges_to_prod";
  if (/TWEET|PUBLISH|CREATE_POST|SHARE_POST/.test(s)) return "public_posts";
  if (/SEND|REPLY|MESSAGE|EMAIL|SMS/.test(s)) return "customer_facing_comms";
  return undefined;
}

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

  // Composio executions share a single action id (composio.execute); the real
  // operation lives in step.config.slug, so derive the tier from the slug.
  if (step.action === COMPOSIO_EXECUTE_ACTION) {
    const cfg = step.config ?? {};
    const slug =
      typeof cfg["slug"] === "string"
        ? (cfg["slug"] as string)
        : typeof cfg["tool"] === "string"
          ? (cfg["tool"] as string)
          : undefined;
    return slug ? composioTierFromSlug(slug) : undefined;
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
