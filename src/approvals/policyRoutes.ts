import express from "express";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { approvalPolicyStore } from "./policyStore";
import {
  APPROVAL_TIER_ACTION_TYPES,
  APPROVAL_TIER_MODES,
  isApprovalTierActionType,
  isApprovalTierMode,
} from "./policyTypes";

const router = express.Router();

function requireWorkspaceId(req: express.Request, res: express.Response): string | null {
  const queryValue = typeof req.query.workspaceId === "string" ? req.query.workspaceId.trim() : "";
  const bodyValue =
    typeof (req.body as { workspaceId?: unknown } | undefined)?.workspaceId === "string"
      ? String((req.body as { workspaceId?: string }).workspaceId).trim()
      : "";
  const workspaceId = queryValue || bodyValue;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return null;
  }
  return workspaceId;
}

router.get("/", async (req: AuthenticatedRequest, res) => {
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

router.put("/:actionType", async (req: AuthenticatedRequest, res) => {
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
