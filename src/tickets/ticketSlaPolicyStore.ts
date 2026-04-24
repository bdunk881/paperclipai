import { randomUUID } from "crypto";
import { parseJsonColumn, serializeJson } from "../db/json";
import { getPostgresPool, isPostgresPersistenceEnabled } from "../db/postgres";
import { TicketPriority } from "./ticketStore";
import {
  defaultPoliciesForWorkspace,
  TicketSlaEscalationPolicy,
  TicketSlaPolicy,
  TicketSlaTarget,
} from "./ticketSla";

interface PolicyRow {
  id: string;
  workspace_id: string;
  priority: TicketPriority;
  first_response_target_json: unknown;
  resolution_target_json: unknown;
  at_risk_threshold: string | number;
  escalation_json: unknown;
  created_at: string;
  updated_at: string;
}

const memoryPolicies = new Map<string, TicketSlaPolicy>();

function cloneTarget(target: TicketSlaTarget): TicketSlaTarget {
  return { ...target };
}

function cloneEscalation(policy: TicketSlaEscalationPolicy): TicketSlaEscalationPolicy {
  return {
    ...policy,
    fallbackAssignee: policy.fallbackAssignee ? { ...policy.fallbackAssignee } : undefined,
  };
}

function clonePolicy(policy: TicketSlaPolicy): TicketSlaPolicy {
  return {
    ...policy,
    firstResponseTarget: cloneTarget(policy.firstResponseTarget),
    resolutionTarget: cloneTarget(policy.resolutionTarget),
    escalation: cloneEscalation(policy.escalation),
  };
}

function mapPolicyRow(row: PolicyRow): TicketSlaPolicy {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    priority: row.priority,
    firstResponseTarget: parseJsonColumn<TicketSlaTarget>(row.first_response_target_json, {
      kind: "minutes",
      value: 60,
    }),
    resolutionTarget: parseJsonColumn<TicketSlaTarget>(row.resolution_target_json, {
      kind: "business_days",
      value: 1,
    }),
    atRiskThreshold: Number(row.at_risk_threshold),
    escalation: parseJsonColumn<TicketSlaEscalationPolicy>(row.escalation_json, {
      notify: true,
      autoBumpPriority: false,
      autoReassign: false,
    }),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function persistPolicy(policy: TicketSlaPolicy): Promise<void> {
  if (!isPostgresPersistenceEnabled()) {
    memoryPolicies.set(policy.id, clonePolicy(policy));
    return;
  }

  await getPostgresPool().query(
    `
      INSERT INTO ticket_sla_policies (
        id, workspace_id, priority, first_response_target_json, resolution_target_json,
        at_risk_threshold, escalation_json, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::jsonb, $8, $9)
      ON CONFLICT (workspace_id, priority) DO UPDATE
      SET first_response_target_json = EXCLUDED.first_response_target_json,
          resolution_target_json = EXCLUDED.resolution_target_json,
          at_risk_threshold = EXCLUDED.at_risk_threshold,
          escalation_json = EXCLUDED.escalation_json,
          updated_at = EXCLUDED.updated_at
    `,
    [
      policy.id,
      policy.workspaceId,
      policy.priority,
      serializeJson(policy.firstResponseTarget),
      serializeJson(policy.resolutionTarget),
      policy.atRiskThreshold,
      serializeJson(policy.escalation),
      policy.createdAt,
      policy.updatedAt,
    ],
  );
}

export const ticketSlaPolicyStore = {
  async ensureDefaults(workspaceId: string): Promise<TicketSlaPolicy[]> {
    const existing = await this.listByWorkspace(workspaceId);
    if (existing.length === 4) {
      return existing;
    }

    const defaults = defaultPoliciesForWorkspace(workspaceId);
    for (const policy of defaults) {
      if (!existing.some((candidate) => candidate.priority === policy.priority)) {
        await persistPolicy(policy);
      }
    }
    return this.listByWorkspace(workspaceId);
  },

  async listByWorkspace(workspaceId: string): Promise<TicketSlaPolicy[]> {
    if (!isPostgresPersistenceEnabled()) {
      return Array.from(memoryPolicies.values())
        .filter((policy) => policy.workspaceId === workspaceId)
        .sort((left, right) => left.priority.localeCompare(right.priority))
        .map(clonePolicy);
    }

    const result = await getPostgresPool().query<PolicyRow>(
      `
        SELECT *
        FROM ticket_sla_policies
        WHERE workspace_id = $1
        ORDER BY priority ASC
      `,
      [workspaceId],
    );
    return result.rows.map(mapPolicyRow);
  },

  async get(workspaceId: string, priority: TicketPriority): Promise<TicketSlaPolicy | undefined> {
    const defaults = await this.ensureDefaults(workspaceId);
    return defaults.find((policy) => policy.priority === priority);
  },

  async upsert(input: {
    workspaceId: string;
    priority: TicketPriority;
    firstResponseTarget: TicketSlaTarget;
    resolutionTarget: TicketSlaTarget;
    atRiskThreshold?: number;
    escalation?: TicketSlaEscalationPolicy;
  }): Promise<TicketSlaPolicy> {
    const existing = await this.get(input.workspaceId, input.priority);
    const now = new Date().toISOString();
    const next: TicketSlaPolicy = {
      id: existing?.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      priority: input.priority,
      firstResponseTarget: cloneTarget(input.firstResponseTarget),
      resolutionTarget: cloneTarget(input.resolutionTarget),
      atRiskThreshold: input.atRiskThreshold ?? existing?.atRiskThreshold ?? 0.75,
      escalation: cloneEscalation(
        input.escalation ?? existing?.escalation ?? {
          notify: true,
          autoBumpPriority: false,
          autoReassign: false,
        },
      ),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await persistPolicy(next);
    return clonePolicy(next);
  },

  async clear(): Promise<void> {
    memoryPolicies.clear();
    if (!isPostgresPersistenceEnabled()) {
      return;
    }
    await getPostgresPool().query("DELETE FROM ticket_sla_policies");
  },
};
