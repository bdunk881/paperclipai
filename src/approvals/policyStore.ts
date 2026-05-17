import { randomUUID } from "crypto";
import { getPostgresPool, inMemoryAllowed, isPostgresPersistenceEnabled } from "../db/postgres";
import {
  ApprovalTierActionType,
  ApprovalTierPolicy,
  defaultApprovalTierPoliciesForWorkspace,
} from "./policyTypes";

interface ApprovalTierPolicyRow {
  id: string;
  workspace_id: string;
  action_type: ApprovalTierActionType;
  mode: ApprovalTierPolicy["mode"];
  spend_threshold_cents: number | null;
  created_at: string;
  updated_at: string;
}

const memoryPolicies = new Map<string, ApprovalTierPolicy>();

function postgresPersistenceAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) {
    return true;
  }
  if (inMemoryAllowed()) {
    return false;
  }
  throw new Error("approvalPolicyStore requires DATABASE_URL outside development/test.");
}

function policyKey(workspaceId: string, actionType: ApprovalTierActionType): string {
  return `${workspaceId}:${actionType}`;
}

function clonePolicy(policy: ApprovalTierPolicy): ApprovalTierPolicy {
  return { ...policy };
}

function mapRow(row: ApprovalTierPolicyRow): ApprovalTierPolicy {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    actionType: row.action_type,
    mode: row.mode,
    spendThresholdCents: row.spend_threshold_cents ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function persistPolicy(policy: ApprovalTierPolicy): Promise<void> {
  if (!postgresPersistenceAvailable()) {
    memoryPolicies.set(policyKey(policy.workspaceId, policy.actionType), clonePolicy(policy));
    return;
  }

  await getPostgresPool().query(
    `
      INSERT INTO approval_tier_policies (
        id, workspace_id, action_type, mode, spend_threshold_cents, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (workspace_id, action_type) DO UPDATE
      SET mode = EXCLUDED.mode,
          spend_threshold_cents = EXCLUDED.spend_threshold_cents,
          updated_at = EXCLUDED.updated_at
    `,
    [
      policy.id,
      policy.workspaceId,
      policy.actionType,
      policy.mode,
      policy.spendThresholdCents ?? null,
      policy.createdAt,
      policy.updatedAt,
    ],
  );
}

export const approvalPolicyStore = {
  async ensureDefaults(workspaceId: string): Promise<ApprovalTierPolicy[]> {
    const existing = await this.listByWorkspace(workspaceId);
    if (existing.length === defaultApprovalTierPoliciesForWorkspace(workspaceId).length) {
      return existing;
    }

    const existingActionTypes = new Set(existing.map((policy) => policy.actionType));
    for (const policy of defaultApprovalTierPoliciesForWorkspace(workspaceId)) {
      if (!existingActionTypes.has(policy.actionType)) {
        await persistPolicy(policy);
      }
    }

    return this.listByWorkspace(workspaceId);
  },

  async listByWorkspace(workspaceId: string): Promise<ApprovalTierPolicy[]> {
    if (!postgresPersistenceAvailable()) {
      return Array.from(memoryPolicies.values())
        .filter((policy) => policy.workspaceId === workspaceId)
        .sort((left, right) => left.actionType.localeCompare(right.actionType))
        .map(clonePolicy);
    }

    const result = await getPostgresPool().query<ApprovalTierPolicyRow>(
      `
        SELECT *
        FROM approval_tier_policies
        WHERE workspace_id = $1
        ORDER BY action_type ASC
      `,
      [workspaceId],
    );

    return result.rows.map(mapRow);
  },

  async get(
    workspaceId: string,
    actionType: ApprovalTierActionType,
  ): Promise<ApprovalTierPolicy | undefined> {
    const policies = await this.ensureDefaults(workspaceId);
    return policies.find((policy) => policy.actionType === actionType);
  },

  async upsert(input: {
    workspaceId: string;
    actionType: ApprovalTierActionType;
    mode: ApprovalTierPolicy["mode"];
    spendThresholdCents?: number;
  }): Promise<ApprovalTierPolicy> {
    const existing = await this.get(input.workspaceId, input.actionType);
    const now = new Date().toISOString();
    const next: ApprovalTierPolicy = {
      id: existing?.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      actionType: input.actionType,
      mode: input.mode,
      // Default $500 (50_000 cents) when no threshold was passed and no
      // prior row exists. A bare 0 here used to leak into the
      // dashboard as a confusing "Spend over $0" display; $500 matches
      // the dashboard's editor default + the canonical seed value, so
      // new policies look intentional out of the box.
      spendThresholdCents:
        input.actionType === "spend_above_threshold"
          ? input.spendThresholdCents ?? existing?.spendThresholdCents ?? 50_000
          : undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await persistPolicy(next);
    return clonePolicy(next);
  },

  async clear(): Promise<void> {
    memoryPolicies.clear();
    if (!postgresPersistenceAvailable()) {
      return;
    }

    await getPostgresPool().query("DELETE FROM approval_tier_policies");
  },
};
