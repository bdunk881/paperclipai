/**
 * Email suppression-list store (HEL-360). Hybrid in-memory / Postgres, mirroring
 * `commsSendStore` / `notificationStore`. Any sender MUST consult
 * `isSuppressed()` before delivering; hard bounces + complaints (HEL-361 SNS
 * webhook) call `suppress()`.
 *
 * `workspace_id IS NULL` rows are global (apply to every workspace). A
 * workspace-scoped read returns the workspace's own rows plus global rows.
 */

import { randomUUID } from "crypto";
import {
  getPostgresPool,
  inMemoryAllowed,
  isPostgresConfigured,
  queryPostgres,
} from "../db/postgres";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import { EmailSuppression, SuppressionReason } from "./types";

/** Folds a NULL (global) workspace_id to a fixed key — matches the unique index. */
const GLOBAL_SENTINEL = "00000000-0000-0000-0000-000000000000";

export interface SuppressInput {
  /** null = global suppression (applies to every workspace). */
  workspaceId: string | null;
  email: string;
  reason: SuppressionReason;
  source?: string | null;
  /** Acting user for RLS on a workspace-scoped write (ignored for global). */
  userId?: string;
}

interface SuppressionRow {
  id: string;
  workspace_id: string | null;
  email: string;
  reason: SuppressionReason;
  source: string | null;
  created_at: string;
}

// allowlist: hybrid store; in-memory mirror of Postgres-backed data
const mem = new Map<string, EmailSuppression>();

function postgresPersistenceAvailable(): boolean {
  if (isPostgresConfigured()) {
    return true;
  }
  if (inMemoryAllowed()) {
    return false;
  }
  throw new Error("suppressionStore requires DATABASE_URL outside development/test.");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function memKey(workspaceId: string | null, normalizedEmail: string): string {
  return `${workspaceId ?? GLOBAL_SENTINEL}:${normalizedEmail}`;
}

function fromRow(row: SuppressionRow): EmailSuppression {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    email: row.email,
    reason: row.reason,
    source: row.source ?? null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

const INSERT_SQL = `INSERT INTO email_suppressions (id, workspace_id, email, reason, source)
   VALUES ($1, $2, $3, $4, $5)
   ON CONFLICT (coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(email))
   DO UPDATE SET source = COALESCE(EXCLUDED.source, email_suppressions.source)
   RETURNING *`;

export const suppressionStore = {
  /** True if `email` is suppressed for `workspaceId` OR globally. */
  async isSuppressed(workspaceId: string, email: string, userId?: string): Promise<boolean> {
    const normalized = normalizeEmail(email);
    if (!postgresPersistenceAvailable()) {
      return mem.has(memKey(workspaceId, normalized)) || mem.has(memKey(null, normalized));
    }
    const result = await withWorkspaceContext(
      getPostgresPool(),
      { workspaceId, userId: userId ?? GLOBAL_SENTINEL },
      (client) =>
        client.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM email_suppressions
             WHERE lower(email) = $1
               AND (workspace_id IS NULL OR workspace_id = $2)
           ) AS exists`,
          [normalized, workspaceId],
        ),
    );
    return result.rows[0]?.exists === true;
  },

  /** Add a suppression (idempotent on scope + email). */
  async suppress(input: SuppressInput): Promise<EmailSuppression> {
    const email = normalizeEmail(input.email);
    const id = randomUUID();

    if (!postgresPersistenceAvailable()) {
      const key = memKey(input.workspaceId, email);
      const existing = mem.get(key);
      if (existing) {
        return { ...existing };
      }
      const record: EmailSuppression = {
        id,
        workspaceId: input.workspaceId,
        email,
        reason: input.reason,
        source: input.source ?? null,
        createdAt: new Date().toISOString(),
      };
      mem.set(key, record);
      return { ...record };
    }

    const params = [id, input.workspaceId, email, input.reason, input.source ?? null];
    // Global writes have no workspace context — the RLS check passes via the
    // `workspace_id is null` branch, so a service-role insert is correct.
    // Scoped writes run under withWorkspaceContext so RLS sees the workspace.
    const result = input.workspaceId
      ? await withWorkspaceContext(
          getPostgresPool(),
          { workspaceId: input.workspaceId, userId: input.userId ?? GLOBAL_SENTINEL },
          (client) => client.query<SuppressionRow>(INSERT_SQL, params),
        )
      : await queryPostgres<SuppressionRow>(INSERT_SQL, params);

    return fromRow(result.rows[0]);
  },

  /** List suppressions visible to a workspace (its own + global). */
  async list(workspaceId: string, userId?: string): Promise<EmailSuppression[]> {
    if (!postgresPersistenceAvailable()) {
      return Array.from(mem.values())
        .filter((s) => s.workspaceId === workspaceId || s.workspaceId === null)
        .sort((a, b) => a.email.localeCompare(b.email));
    }
    const result = await withWorkspaceContext(
      getPostgresPool(),
      { workspaceId, userId: userId ?? GLOBAL_SENTINEL },
      (client) =>
        client.query<SuppressionRow>(
          `SELECT * FROM email_suppressions
            WHERE workspace_id IS NULL OR workspace_id = $1
            ORDER BY lower(email)`,
          [workspaceId],
        ),
    );
    return result.rows.map(fromRow);
  },

  /** Test/dev only: wipe the suppression list. */
  async clear(): Promise<void> {
    mem.clear();
    if (!postgresPersistenceAvailable()) {
      return;
    }
    await queryPostgres("DELETE FROM email_suppressions");
  },
};
