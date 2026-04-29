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

export interface SecretsContext {
  workspaceId: string;
  userId: string;
  actor: string;
}

interface SecretRow {
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  key_version: number;
}

interface SecretListRow {
  key: string;
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  key_version: number;
}

function maskSecretValue(secret: string): string {
  const trimmed = secret.trim();
  if (!trimmed) {
    return "****";
  }
  const suffix = trimmed.slice(-4);
  return `${"*".repeat(Math.max(8, trimmed.length - suffix.length))}${suffix}`;
}

async function recordAudit(
  client: PoolClient,
  params: {
    workspaceId: string;
    companyId: string;
    key: string;
    action: "read" | "write" | "rotate" | "delete";
    actor: string;
    keyVersion: number;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO control_plane_secret_audit (
       workspace_id, company_id, key, action, actor, key_version, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      params.workspaceId,
      params.companyId,
      params.key,
      params.action,
      params.actor,
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
    const { ciphertext, iv, authTag, keyVersion } = encryptSecret(value);
    return withWorkspaceContext(
      getPostgresPool(),
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      async (client) => {
        await client.query(
          `INSERT INTO provisioned_company_secrets (
             workspace_id, company_id, key, ciphertext, iv, auth_tag, key_version
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (company_id, key) DO UPDATE
             SET ciphertext = EXCLUDED.ciphertext,
                 iv = EXCLUDED.iv,
                 auth_tag = EXCLUDED.auth_tag,
                 key_version = EXCLUDED.key_version,
                 updated_at = now()`,
          [ctx.workspaceId, companyId, key, ciphertext, iv, authTag, keyVersion]
        );
        await recordAudit(client, {
          workspaceId: ctx.workspaceId,
          companyId,
          key,
          action: "write",
          actor: ctx.actor,
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
    const activeVersion = getActiveKeyVersion();
    const encrypted = entries.map(([key, value]) => ({
      key,
      record: encryptSecret(value, activeVersion),
    }));
    await withWorkspaceContext(
      getPostgresPool(),
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      async (client) => {
        for (const { key, record } of encrypted) {
          await client.query(
            `INSERT INTO provisioned_company_secrets (
               workspace_id, company_id, key, ciphertext, iv, auth_tag, key_version
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (company_id, key) DO UPDATE
               SET ciphertext = EXCLUDED.ciphertext,
                   iv = EXCLUDED.iv,
                   auth_tag = EXCLUDED.auth_tag,
                   key_version = EXCLUDED.key_version,
                   updated_at = now()`,
            [
              ctx.workspaceId,
              companyId,
              key,
              record.ciphertext,
              record.iv,
              record.authTag,
              record.keyVersion,
            ]
          );
          await recordAudit(client, {
            workspaceId: ctx.workspaceId,
            companyId,
            key,
            action: "write",
            actor: ctx.actor,
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
        const plaintext = decryptSecret(record);
        await recordAudit(client, {
          workspaceId: ctx.workspaceId,
          companyId,
          key,
          action: "read",
          actor: ctx.actor,
          keyVersion: row.key_version,
        });
        return plaintext;
      }
    );
  },

  async listSecretSummaries(
    ctx: SecretsContext,
    companyId: string
  ): Promise<ProvisionedCompanySecretBinding[]> {
    return withWorkspaceContext(
      getPostgresPool(),
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      async (client) => {
        const result = await client.query<SecretListRow>(
          `SELECT key, ciphertext, iv, auth_tag, key_version
             FROM provisioned_company_secrets
            WHERE company_id = $1
            ORDER BY key ASC`,
          [companyId]
        );
        return result.rows.map((row) => {
          const plaintext = decryptSecret({
            ciphertext: row.ciphertext,
            iv: row.iv,
            authTag: row.auth_tag,
            keyVersion: row.key_version,
          });
          return { key: row.key, maskedValue: maskSecretValue(plaintext) };
        });
      }
    );
  },

  async deleteSecret(
    ctx: SecretsContext,
    companyId: string,
    key: string
  ): Promise<boolean> {
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
          actor: ctx.actor,
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
    return withWorkspaceContext(
      getPostgresPool(),
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      async (client) => {
        const rows = await client.query<SecretListRow>(
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
          await client.query(
            `UPDATE provisioned_company_secrets
               SET ciphertext = $1,
                   iv = $2,
                   auth_tag = $3,
                   key_version = $4,
                   updated_at = now()
             WHERE company_id = $5 AND key = $6`,
            [re.ciphertext, re.iv, re.authTag, re.keyVersion, companyId, row.key]
          );
          await recordAudit(client, {
            workspaceId: ctx.workspaceId,
            companyId,
            key: row.key,
            action: "rotate",
            actor: ctx.actor,
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
