import { auditService, type AuditCategory, type AuditTarget } from "./auditService";
import { isPostgresPersistenceEnabled, queryPostgres } from "../db/postgres";

export interface ControlPlaneAuditInput {
  workspaceId?: string | null;
  userId: string;
  actorUserId?: string | null;
  actorAgentId?: string | null;
  category: AuditCategory;
  action: string;
  target?: AuditTarget | null;
  metadata?: Record<string, unknown> | null;
}

function shouldEmitAudit(workspaceId?: string | null): workspaceId is string {
  return Boolean(workspaceId?.trim()) && isPostgresPersistenceEnabled();
}

export async function recordControlPlaneAudit(input: ControlPlaneAuditInput): Promise<void> {
  if (!shouldEmitAudit(input.workspaceId)) {
    return;
  }

  try {
    await auditService.recordAction(
      {
        workspaceId: input.workspaceId.trim(),
        userId: input.userId,
        actorUserId: input.actorUserId ?? input.userId,
        actorAgentId: input.actorAgentId ?? null,
      },
      {
        category: input.category,
        action: input.action,
        target: input.target ?? undefined,
        metadata: input.metadata ?? undefined,
      },
    );
  } catch (error) {
    console.warn("[audit] Failed to record control-plane audit event", {
      category: input.category,
      action: input.action,
      workspaceId: input.workspaceId,
      targetType: input.target?.type,
      targetId: input.target?.id,
      error: (error as Error).message,
    });
  }
}

export async function recordControlPlaneAuditBatch(inputs: ControlPlaneAuditInput[]): Promise<void> {
  for (const input of inputs) {
    await recordControlPlaneAudit(input);
  }
}

export async function resolveAuditWorkspaceIdForUser(
  userId: string,
  explicitWorkspaceId?: string | null,
): Promise<string | null> {
  if (explicitWorkspaceId?.trim()) {
    return explicitWorkspaceId.trim();
  }

  if (!isPostgresPersistenceEnabled()) {
    return null;
  }

  const ownedWorkspaces = await queryPostgres<{ id: string }>(
    "SELECT id FROM workspaces WHERE owner_user_id = $1 ORDER BY created_at ASC LIMIT 2",
    [userId],
  );
  const ownedIds = ownedWorkspaces.rows.map((row) => row.id);
  if (ownedIds.length === 1) {
    return ownedIds[0];
  }
  if (ownedIds.length > 1) {
    return null;
  }

  const memberWorkspaces = await queryPostgres<{ id: string }>(
    `SELECT wm.workspace_id AS id
       FROM workspace_members wm
      WHERE wm.user_id = $1
      ORDER BY wm.created_at ASC
      LIMIT 2`,
    [userId],
  );
  const memberIds = memberWorkspaces.rows.map((row) => row.id);
  return memberIds.length === 1 ? memberIds[0] : null;
}
