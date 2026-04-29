import { PoolClient } from "pg";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import { getPostgresPool } from "../db/postgres";
import {
  decryptSecret,
  encryptSecret,
  getActiveKeyVersion,
  type EncryptedSecret,
} from "./secretEncryption";
import type { ProvisionedCompanySecretBinding } from "./types";

// SecretsContext now carries server-derived principal identity instead of a
// caller-supplied free-form `actor` string. ALT-2027: a workspace-scoped caller
// must not be able to spoof another principal in the audit ledger, so the
// repository never accepts a single opaque actor field. At least one of
// actorUserId / actorAgentId must be present (matched by the
// control_plane_secret_audit_actor_present CHECK constraint in migration 018).
export interface SecretsContext {
  workspaceId: string;
  userId: string;
  actorUserId?: string;
  actorAgentId?: string;
}

interface SecretRow {
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  key_version: number;
}

interface SecretListSummaryRow {
  key: string;
  value_mask_suffix: string | null;
}

interface SecretRotationRow {
  key: string;
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  key_version: number;
}

const LIST_AUDIT_KEY = "*";
const MASK_PREFIX = "********";

type AuditAction = "read" | "read_failed" | "write" | "rotate" | "delete" | "list";

function computeMaskSuffix(plaintext: string): string {
  const trimmed = plaintext.trim();
  return trimmed.slice(-4);
}

function renderMaskedValue(suffix: string | null | undefined): string {
  return suffix ? `${MASK_PREFIX}${suffix}` : MASK_PREFIX;
}

function resolveAuditActor(ctx: SecretsContext): {
  actorUserId: string | null;
  actorAgentId: string | null;
} {
  const actorUserId = ctx.actorUserId?.trim() || null;
  const actorAgentId = ctx.actorAgentId?.trim() || null;
  if (!actorUserId && !actorAgentId) {
    // Mirror the DB CHECK so callers fail fast in app code instead of
    // surfacing a constraint-violation error from Postgres.
    throw new Error("secrets_audit_actor_required");
  }
  return { actorUserId, actorAgentId };
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  return "unknown_error";
}

async function recordAudit(
  client: PoolClient,
  params: {
    workspaceId: string;
    companyId: string;
    key: string;
    action: AuditAction;
    actorUserId: string | null;
    actorAgentId: string | null;
    keyVersion: number;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO control_plane_secret_audit (
       workspace_id, company_id, key, action,
       actor_user_id, actor_agent_id, key_version, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      params.workspaceId,
      params.companyId,
      params.key,
      params.action,
      params.actorUserId,
      params.actorAgentId,
      params.keyVersion,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ]
  );
}

async function loadSecretRow(
  client: PoolClient,
  companyId: string,
  key: string
): Promise<SecretRow | null> {
  const result = await client.query<SecretRow>(
    `SELECT ciphertext, iv, auth_tag, key_version
       FROM provisioned_company_secrets
      WHERE company_id = $1 AND key = $2`,
    [companyId, key]
  );
  return result.rows[0] ?? null;
}

export const secretsRepository = {
  async setSecret(
    ctx: SecretsContext,
    companyId: string,
    key: string,
    value: string
  ): Promise<{ keyVersion: number }> {
    const { actorUserId, actorAgentId } = resolveAuditActor(ctx);
    const { ciphertext, iv, authTag, keyVersion } = encryptSecret(value);
    const maskSuffix = computeMaskSuffix(value);
    return withWorkspaceContext(
      getPostgresPool(),
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      async (client) => {
        await client.query(
          `INSERT INTO provisioned_company_secrets (
             workspace_id, company_id, key, ciphertext, iv, auth_tag, key_version, value_mask_suffix
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (company_id, key) DO UPDATE
             SET ciphertext = EXCLUDED.ciphertext,
                 iv = EXCLUDED.iv,
                 auth_tag = EXCLUDED.auth_tag,
                 key_version = EXCLUDED.key_version,
                 value_mask_suffix = EXCLUDED.value_mask_suffix,
                 updated_at = now()`,
          [
            ctx.workspaceId,
            companyId,
            key,
            ciphertext,
            iv,
            authTag,
            keyVersion,
            maskSuffix,
          ]
        );
        await recordAudit(client, {
          workspaceId: ctx.workspaceId,
          companyId,
          key,
          action: "write",
          actorUserId,
          actorAgentId,
          keyVersion,
        });
        return { keyVersion };
      }
    );
  },

  async setSecrets(
    ctx: SecretsContext,
    companyId: string,
    bindings: Record<string, string>
  ): Promise<void> {
    const entries = Object.entries(bindings);
    if (entries.length === 0) {
      return;
    }
    const { actorUserId, actorAgentId } = resolveAuditActor(ctx);
    const activeVersion = getActiveKeyVersion();
    const encrypted = entries.map(([key, value]) => ({
      key,
      record: encryptSecret(value, activeVersion),
      maskSuffix: computeMaskSuffix(value),
    }));
    await withWorkspaceContext(
      getPostgresPool(),
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      async (client) => {
        for (const { key, record, maskSuffix } of encrypted) {
          await client.query(
            `INSERT INTO provisioned_company_secrets (
               workspace_id, company_id, key, ciphertext, iv, auth_tag, key_version, value_mask_suffix
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (company_id, key) DO UPDATE
               SET ciphertext = EXCLUDED.ciphertext,
                   iv = EXCLUDED.iv,
                   auth_tag = EXCLUDED.auth_tag,
                   key_version = EXCLUDED.key_version,
                   value_mask_suffix = EXCLUDED.value_mask_suffix,
                   updated_at = now()`,
            [
              ctx.workspaceId,
              companyId,
              key,
              record.ciphertext,
              record.iv,
              record.authTag,
              record.keyVersion,
              maskSuffix,
            ]
          );
          await recordAudit(client, {
            workspaceId: ctx.workspaceId,
            companyId,
            key,
            action: "write",
            actorUserId,
            actorAgentId,
            keyVersion: record.keyVersion,
          });
        }
      }
    );
  },

  async getSecret(
    ctx: SecretsContext,
    companyId: string,
    key: string
  ): Promise<string | null> {
    const { actorUserId, actorAgentId } = resolveAuditActor(ctx);
    return withWorkspaceContext(
      getPostgresPool(),
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      async (client) => {
        const row = await loadSecretRow(client, companyId, key);
        if (!row) {
          return null;
        }
        const record: EncryptedSecret = {
          ciphertext: row.ciphertext,
          iv: row.iv,
          authTag: row.auth_tag,
          keyVersion: row.key_version,
        };
        try {
          const plaintext = decryptSecret(record);
          await recordAudit(client, {
            workspaceId: ctx.workspaceId,
            companyId,
            key,
            action: "read",
            actorUserId,
            actorAgentId,
            keyVersion: row.key_version,
          });
          return plaintext;
        } catch (err) {
          // Tamper / wrong-key-version / corrupted-row paths: leave a
          // tamper-evident trail before surfacing the error so SIEM can flag
          // them without needing to correlate with application logs.
          await recordAudit(client, {
            workspaceId: ctx.workspaceId,
            companyId,
            key,
            action: "read_failed",
            actorUserId,
            actorAgentId,
            keyVersion: row.key_version,
            metadata: { reason: describeError(err) },
          });
          throw err;
        }
      }
    );
  },

  async listSecretSummaries(
    ctx: SecretsContext,
    companyId: string
  ): Promise<ProvisionedCompanySecretBinding[]> {
    const { actorUserId, actorAgentId } = resolveAuditActor(ctx);
    return withWorkspaceContext(
      getPostgresPool(),
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      async (client) => {
        // Read only the masked suffix; no plaintext leaves the database. This
        // also avoids pulling every ciphertext/IV/auth-tag tuple back to the
        // app layer just to compute a UI mask.
        const result = await client.query<SecretListSummaryRow>(
          `SELECT key, value_mask_suffix
             FROM provisioned_company_secrets
            WHERE company_id = $1
            ORDER BY key ASC`,
          [companyId]
        );
        await recordAudit(client, {
          workspaceId: ctx.workspaceId,
          companyId,
          key: LIST_AUDIT_KEY,
          action: "list",
          actorUserId,
          actorAgentId,
          keyVersion: getActiveKeyVersion(),
          metadata: { count: result.rows.length },
        });
        return result.rows.map((row) => ({
          key: row.key,
          maskedValue: renderMaskedValue(row.value_mask_suffix),
        }));
      }
    );
  },

  async deleteSecret(
    ctx: SecretsContext,
    companyId: string,
    key: string
  ): Promise<boolean> {
    const { actorUserId, actorAgentId } = resolveAuditActor(ctx);
    return withWorkspaceContext(
      getPostgresPool(),
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      async (client) => {
        const result = await client.query(
          `DELETE FROM provisioned_company_secrets WHERE company_id = $1 AND key = $2`,
          [companyId, key]
        );
        if ((result.rowCount ?? 0) === 0) {
          return false;
        }
        await recordAudit(client, {
          workspaceId: ctx.workspaceId,
          companyId,
          key,
          action: "delete",
          actorUserId,
          actorAgentId,
          keyVersion: getActiveKeyVersion(),
        });
        return true;
      }
    );
  },

  async rotateCompanySecrets(
    ctx: SecretsContext,
    companyId: string,
    newKeyVersion: number
  ): Promise<{ rotated: number }> {
    const { actorUserId, actorAgentId } = resolveAuditActor(ctx);
    return withWorkspaceContext(
      getPostgresPool(),
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      async (client) => {
        const rows = await client.query<SecretRotationRow>(
          `SELECT key, ciphertext, iv, auth_tag, key_version
             FROM provisioned_company_secrets
            WHERE company_id = $1
              AND key_version <> $2`,
          [companyId, newKeyVersion]
        );
        let rotated = 0;
        for (const row of rows.rows) {
          const plaintext = decryptSecret({
            ciphertext: row.ciphertext,
            iv: row.iv,
            authTag: row.auth_tag,
            keyVersion: row.key_version,
          });
          const re = encryptSecret(plaintext, newKeyVersion);
          const maskSuffix = computeMaskSuffix(plaintext);
          await client.query(
            `UPDATE provisioned_company_secrets
               SET ciphertext = $1,
                   iv = $2,
                   auth_tag = $3,
                   key_version = $4,
                   value_mask_suffix = $5,
                   updated_at = now()
             WHERE company_id = $6 AND key = $7`,
            [
              re.ciphertext,
              re.iv,
              re.authTag,
              re.keyVersion,
              maskSuffix,
              companyId,
              row.key,
            ]
          );
          await recordAudit(client, {
            workspaceId: ctx.workspaceId,
            companyId,
            key: row.key,
            action: "rotate",
            actorUserId,
            actorAgentId,
            keyVersion: re.keyVersion,
            metadata: { previousKeyVersion: row.key_version },
          });
          rotated += 1;
        }
        return { rotated };
      }
    );
  },
};

export type SecretsRepository = typeof secretsRepository;
