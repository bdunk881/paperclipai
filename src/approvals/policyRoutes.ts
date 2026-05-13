import express from "express";
import { requireEntitlement } from "../middleware/requireEntitlement";
import { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import { approvalPolicyStore } from "./policyStore";
import {
  APPROVAL_TIER_ACTION_TYPES,
  APPROVAL_TIER_MODES,
  isApprovalTierActionType,
  isApprovalTierMode,
} from "./policyTypes";

// Maps an approval mode to its numeric tier level so requireEntitlement can
// compare it against the workspace's approvalTierMax quota.
const APPROVAL_MODE_TIER: Record<string, number> = {
  auto_approve: 0,
  notify_only: 1,
  require_approval: 2,
};

const router = express.Router();

function requireWorkspaceId(req: WorkspaceAwareRequest, res: express.Response): string | null {
  const workspaceId = req.workspaceId?.trim();
  if (!workspaceId) {
    res.status(500).json({ error: "Workspace context was not resolved for the request" });
    return null;
  }
  return workspaceId;
}

router.get("/", async (req: WorkspaceAwareRequest, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) {
    return;
  }

  const policies = await approvalPolicyStore.ensureDefaults(workspaceId);
  res.json({
    actionTypes: APPROVAL_TIER_ACTION_TYPES,
    modes: APPROVAL_TIER_MODES,
    policies,
    total: policies.length,
  });
});

router.put(
  "/:actionType",
  requireEntitlement("approvalTierMax", {
    // Treat the requested mode as an ordinal tier level and deny if it exceeds
    // the workspace's approvalTierMax. delta=0 because we're checking the
    // absolute level, not incrementing a count.
    getCurrent: (req) => APPROVAL_MODE_TIER[(req.body as { mode?: string }).mode ?? "auto_approve"] ?? 0,
    delta: 0,
  }),
  async (req: WorkspaceAwareRequest, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) {
    return;
  }

  const actionType = req.params.actionType;
  if (!isApprovalTierActionType(actionType)) {
    res.status(400).json({ error: "Unknown approval tier actionType" });
    return;
  }

  const { mode, spendThresholdCents } = req.body as {
    mode?: unknown;
    spendThresholdCents?: unknown;
  };

  if (!isApprovalTierMode(mode)) {
    res.status(400).json({ error: "mode must be one of auto_approve, notify_only, require_approval" });
    return;
  }

  if (actionType === "spend_above_threshold") {
    if (
      spendThresholdCents !== undefined &&
      (typeof spendThresholdCents !== "number" ||
        !Number.isInteger(spendThresholdCents) ||
        spendThresholdCents < 0)
    ) {
      res.status(400).json({ error: "spendThresholdCents must be a non-negative integer" });
      return;
    }
  }

  const policy = await approvalPolicyStore.upsert({
    workspaceId,
    actionType,
    mode,
    spendThresholdCents:
      actionType === "spend_above_threshold" && typeof spendThresholdCents === "number"
        ? spendThresholdCents
        : undefined,
  });

  res.json({ policy });
});

export default router;
