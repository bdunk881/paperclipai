/**
 * Persistence layer for app-issued MFA artifacts (HEL-mfa).
 *
 * Why an app-layer repo when Supabase has its own MFA tables?
 * Supabase Auth's `auth.mfa_factors` covers TOTP and Phone factors that
 * Supabase itself verifies and stamps into the JWT (`aal`/`amr` claims).
 * We piggyback on that for TOTP. WebAuthn passkeys, however, are not a
 * Supabase factor type — we verify them ourselves with SimpleWebAuthn, so
 * we own:
 *   - mfa_webauthn_credentials (one row per registered authenticator)
 *   - mfa_recovery_codes (printable one-time-use codes for both paths)
 *   - user_mfa_policy (bookkeeping for the enforcement gate)
 *
 * `InMemoryMfaRepository` mirrors the postgres implementation 1:1 so unit
 * tests can exercise the service without a database (the standard
 * AUTOFLOW_ALLOW_INMEMORY pattern used by the rest of the codebase).
 */

import { randomUUID } from "node:crypto";
import { getPostgresPool, isPostgresPersistenceEnabled } from "../db/postgres";
import { withUserContext } from "../middleware/workspaceContext";

export interface WebauthnCredentialRow {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: Buffer;
  signCount: bigint;
  transports: string[];
  deviceName: string | null;
  aaguid: string | null;
  backedUp: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface RecoveryCodeRow {
  id: string;
  userId: string;
  codeHash: string;
  usedAt: Date | null;
  createdAt: Date;
}

export interface UserMfaPolicyRow {
  userId: string;
  hasWebauthn: boolean;
  hasTotp: boolean;
  recoveryCodesIssuedAt: Date | null;
  enrollmentCompletedAt: Date | null;
  lastVerifiedAt: Date | null;
  lastVerifiedMethod: "webauthn" | "totp" | "recovery_code" | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InsertWebauthnCredentialInput {
  userId: string;
  credentialId: string;
  publicKey: Buffer;
  signCount: bigint;
  transports: string[];
  deviceName?: string | null;
  aaguid?: string | null;
  backedUp?: boolean;
}

export interface MfaRepository {
  listWebauthnCredentials(userId: string): Promise<WebauthnCredentialRow[]>;
  /**
   * HEL-298: takes `userId` so the postgres impl can scope the lookup
   * inside `withUserContext` — required after migration 083 turned on
   * FORCE RLS on `mfa_webauthn_credentials`. The signature was previously
   * just `(credentialId)`; the caller already had `ctx.userId` in hand so
   * threading it through was free.
   */
  findWebauthnCredentialById(
    userId: string,
    credentialId: string,
  ): Promise<WebauthnCredentialRow | null>;
  insertWebauthnCredential(input: InsertWebauthnCredentialInput): Promise<WebauthnCredentialRow>;
  /**
   * HEL-298: takes `userId` so the postgres impl can scope the UPDATE
   * inside `withUserContext`. The caller already has it in `ctx.userId`.
   */
  updateWebauthnSignCount(
    userId: string,
    credentialId: string,
    signCount: bigint,
    lastUsedAt: Date,
  ): Promise<void>;
  deleteWebauthnCredential(userId: string, credentialId: string): Promise<boolean>;

  replaceRecoveryCodes(userId: string, hashes: string[]): Promise<void>;
  countActiveRecoveryCodes(userId: string): Promise<number>;
  consumeRecoveryCode(userId: string, predicate: (hash: string) => Promise<boolean>): Promise<boolean>;

  getPolicy(userId: string): Promise<UserMfaPolicyRow | null>;
  upsertPolicy(userId: string, patch: Partial<Omit<UserMfaPolicyRow, "userId" | "createdAt" | "updatedAt">>): Promise<UserMfaPolicyRow>;
}

// ---------------------------------------------------------------------------
// Postgres implementation
// ---------------------------------------------------------------------------

function rowToWebauthn(row: Record<string, unknown>): WebauthnCredentialRow {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    credentialId: String(row.credential_id),
    publicKey: row.public_key as Buffer,
    signCount: BigInt(String(row.sign_count ?? "0")),
    transports: Array.isArray(row.transports) ? (row.transports as string[]) : [],
    deviceName: row.device_name == null ? null : String(row.device_name),
    aaguid: row.aaguid == null ? null : String(row.aaguid),
    backedUp: Boolean(row.backed_up),
    createdAt: new Date(String(row.created_at)),
    lastUsedAt: row.last_used_at == null ? null : new Date(String(row.last_used_at)),
  };
}

function rowToPolicy(row: Record<string, unknown>): UserMfaPolicyRow {
  return {
    userId: String(row.user_id),
    hasWebauthn: Boolean(row.has_webauthn),
    hasTotp: Boolean(row.has_totp),
    recoveryCodesIssuedAt: row.recovery_codes_issued_at == null ? null : new Date(String(row.recovery_codes_issued_at)),
    enrollmentCompletedAt: row.enrollment_completed_at == null ? null : new Date(String(row.enrollment_completed_at)),
    lastVerifiedAt: row.last_verified_at == null ? null : new Date(String(row.last_verified_at)),
    lastVerifiedMethod: (row.last_verified_method as UserMfaPolicyRow["lastVerifiedMethod"]) ?? null,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

/**
 * HEL-298: every method runs inside `withUserContext(pool, userId, ...)`
 * so the `app.current_user_id` GUC is set per-transaction. Migration 083
 * (HEL-273) put `FORCE ROW LEVEL SECURITY` on `mfa_webauthn_credentials`,
 * `mfa_recovery_codes`, and `user_mfa_policy` with policies of the shape
 * `app_current_user_id() IS NOT NULL AND user_id::text = app_current_user_id()`.
 * Without the wrapper, every SELECT silently returns 0 rows and every
 * INSERT/UPDATE throws `new row violates row-level security policy`.
 *
 * HEL-272 listed this file as a refactor target but the PR shipped without
 * touching it. This module finishes that work.
 */
export class PostgresMfaRepository implements MfaRepository {
  async listWebauthnCredentials(userId: string): Promise<WebauthnCredentialRow[]> {
    return withUserContext(getPostgresPool(), userId, async (client) => {
      const result = await client.query(
        `SELECT id, user_id, credential_id, public_key, sign_count, transports,
                device_name, aaguid, backed_up, created_at, last_used_at
           FROM mfa_webauthn_credentials
          WHERE user_id = $1
          ORDER BY created_at DESC`,
        [userId],
      );
      return result.rows.map((r) => rowToWebauthn(r as Record<string, unknown>));
    });
  }

  async findWebauthnCredentialById(
    userId: string,
    credentialId: string,
  ): Promise<WebauthnCredentialRow | null> {
    return withUserContext(getPostgresPool(), userId, async (client) => {
      const result = await client.query(
        `SELECT id, user_id, credential_id, public_key, sign_count, transports,
                device_name, aaguid, backed_up, created_at, last_used_at
           FROM mfa_webauthn_credentials
          WHERE credential_id = $1 AND user_id = $2
          LIMIT 1`,
        [credentialId, userId],
      );
      if (result.rows.length === 0) return null;
      return rowToWebauthn(result.rows[0] as Record<string, unknown>);
    });
  }

  async insertWebauthnCredential(input: InsertWebauthnCredentialInput): Promise<WebauthnCredentialRow> {
    return withUserContext(getPostgresPool(), input.userId, async (client) => {
      const result = await client.query(
        `INSERT INTO mfa_webauthn_credentials
           (user_id, credential_id, public_key, sign_count, transports, device_name, aaguid, backed_up)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, user_id, credential_id, public_key, sign_count, transports,
                   device_name, aaguid, backed_up, created_at, last_used_at`,
        [
          input.userId,
          input.credentialId,
          input.publicKey,
          input.signCount.toString(),
          input.transports,
          input.deviceName ?? null,
          input.aaguid ?? null,
          input.backedUp ?? false,
        ],
      );
      return rowToWebauthn(result.rows[0] as Record<string, unknown>);
    });
  }

  async updateWebauthnSignCount(
    userId: string,
    credentialId: string,
    signCount: bigint,
    lastUsedAt: Date,
  ): Promise<void> {
    await withUserContext(getPostgresPool(), userId, async (client) => {
      await client.query(
        `UPDATE mfa_webauthn_credentials
            SET sign_count = $2, last_used_at = $3
          WHERE credential_id = $1 AND user_id = $4`,
        [credentialId, signCount.toString(), lastUsedAt, userId],
      );
    });
  }

  async deleteWebauthnCredential(userId: string, credentialId: string): Promise<boolean> {
    return withUserContext(getPostgresPool(), userId, async (client) => {
      const result = await client.query(
        `DELETE FROM mfa_webauthn_credentials WHERE user_id = $1 AND credential_id = $2`,
        [userId, credentialId],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  async replaceRecoveryCodes(userId: string, hashes: string[]): Promise<void> {
    await withUserContext(getPostgresPool(), userId, async (client) => {
      await client.query(`DELETE FROM mfa_recovery_codes WHERE user_id = $1`, [userId]);
      for (const hash of hashes) {
        await client.query(
          `INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)`,
          [userId, hash],
        );
      }
    });
  }

  async countActiveRecoveryCodes(userId: string): Promise<number> {
    return withUserContext(getPostgresPool(), userId, async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM mfa_recovery_codes
          WHERE user_id = $1 AND used_at IS NULL`,
        [userId],
      );
      return Number.parseInt(result.rows[0]?.count ?? "0", 10);
    });
  }

  async consumeRecoveryCode(
    userId: string,
    predicate: (hash: string) => Promise<boolean>,
  ): Promise<boolean> {
    return withUserContext(getPostgresPool(), userId, async (client) => {
      const result = await client.query<{ id: string; code_hash: string }>(
        `SELECT id, code_hash
           FROM mfa_recovery_codes
          WHERE user_id = $1 AND used_at IS NULL
          ORDER BY created_at ASC`,
        [userId],
      );
      for (const row of result.rows) {
        if (await predicate(row.code_hash)) {
          await client.query(`UPDATE mfa_recovery_codes SET used_at = now() WHERE id = $1`, [row.id]);
          return true;
        }
      }
      return false;
    });
  }

  async getPolicy(userId: string): Promise<UserMfaPolicyRow | null> {
    return withUserContext(getPostgresPool(), userId, async (client) => {
      const result = await client.query(
        `SELECT user_id, has_webauthn, has_totp, recovery_codes_issued_at,
                enrollment_completed_at, last_verified_at, last_verified_method,
                created_at, updated_at
           FROM user_mfa_policy
          WHERE user_id = $1`,
        [userId],
      );
      if (result.rows.length === 0) return null;
      return rowToPolicy(result.rows[0] as Record<string, unknown>);
    });
  }

  async upsertPolicy(
    userId: string,
    patch: Partial<Omit<UserMfaPolicyRow, "userId" | "createdAt" | "updatedAt">>,
  ): Promise<UserMfaPolicyRow> {
    return withUserContext(getPostgresPool(), userId, async (client) => {
      const result = await client.query(
        `INSERT INTO user_mfa_policy
           (user_id, has_webauthn, has_totp, recovery_codes_issued_at,
            enrollment_completed_at, last_verified_at, last_verified_method)
         VALUES ($1, COALESCE($2, FALSE), COALESCE($3, FALSE), $4, $5, $6, $7)
         ON CONFLICT (user_id) DO UPDATE
           SET has_webauthn             = COALESCE($2, user_mfa_policy.has_webauthn),
               has_totp                 = COALESCE($3, user_mfa_policy.has_totp),
               recovery_codes_issued_at = COALESCE($4, user_mfa_policy.recovery_codes_issued_at),
               enrollment_completed_at  = COALESCE($5, user_mfa_policy.enrollment_completed_at),
               last_verified_at         = COALESCE($6, user_mfa_policy.last_verified_at),
               last_verified_method     = COALESCE($7, user_mfa_policy.last_verified_method)
         RETURNING user_id, has_webauthn, has_totp, recovery_codes_issued_at,
                   enrollment_completed_at, last_verified_at, last_verified_method,
                   created_at, updated_at`,
        [
          userId,
          patch.hasWebauthn ?? null,
          patch.hasTotp ?? null,
          patch.recoveryCodesIssuedAt ?? null,
          patch.enrollmentCompletedAt ?? null,
          patch.lastVerifiedAt ?? null,
          patch.lastVerifiedMethod ?? null,
        ],
      );
      return rowToPolicy(result.rows[0] as Record<string, unknown>);
    });
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation (for tests + AUTOFLOW_ALLOW_INMEMORY dev mode)
// ---------------------------------------------------------------------------

export class InMemoryMfaRepository implements MfaRepository {
  private credentials = new Map<string, WebauthnCredentialRow>(); // keyed by credential_id
  private recoveryCodes = new Map<string, RecoveryCodeRow[]>(); // keyed by user_id
  private policies = new Map<string, UserMfaPolicyRow>(); // keyed by user_id

  reset(): void {
    this.credentials.clear();
    this.recoveryCodes.clear();
    this.policies.clear();
  }

  async listWebauthnCredentials(userId: string): Promise<WebauthnCredentialRow[]> {
    return Array.from(this.credentials.values())
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findWebauthnCredentialById(
    userId: string,
    credentialId: string,
  ): Promise<WebauthnCredentialRow | null> {
    const row = this.credentials.get(credentialId);
    return row && row.userId === userId ? row : null;
  }

  async insertWebauthnCredential(input: InsertWebauthnCredentialInput): Promise<WebauthnCredentialRow> {
    const row: WebauthnCredentialRow = {
      id: randomUUID(),
      userId: input.userId,
      credentialId: input.credentialId,
      publicKey: input.publicKey,
      signCount: input.signCount,
      transports: input.transports.slice(),
      deviceName: input.deviceName ?? null,
      aaguid: input.aaguid ?? null,
      backedUp: input.backedUp ?? false,
      createdAt: new Date(),
      lastUsedAt: null,
    };
    this.credentials.set(input.credentialId, row);
    return row;
  }

  async updateWebauthnSignCount(
    userId: string,
    credentialId: string,
    signCount: bigint,
    lastUsedAt: Date,
  ): Promise<void> {
    const existing = this.credentials.get(credentialId);
    if (!existing || existing.userId !== userId) return;
    existing.signCount = signCount;
    existing.lastUsedAt = lastUsedAt;
  }

  async deleteWebauthnCredential(userId: string, credentialId: string): Promise<boolean> {
    const row = this.credentials.get(credentialId);
    if (!row || row.userId !== userId) return false;
    this.credentials.delete(credentialId);
    return true;
  }

  async replaceRecoveryCodes(userId: string, hashes: string[]): Promise<void> {
    const now = new Date();
    this.recoveryCodes.set(
      userId,
      hashes.map((codeHash) => ({
        id: randomUUID(),
        userId,
        codeHash,
        usedAt: null,
        createdAt: now,
      })),
    );
  }

  async countActiveRecoveryCodes(userId: string): Promise<number> {
    const codes = this.recoveryCodes.get(userId) ?? [];
    return codes.filter((c) => c.usedAt == null).length;
  }

  async consumeRecoveryCode(
    userId: string,
    predicate: (hash: string) => Promise<boolean>,
  ): Promise<boolean> {
    const codes = this.recoveryCodes.get(userId) ?? [];
    for (const row of codes) {
      if (row.usedAt) continue;
      if (await predicate(row.codeHash)) {
        row.usedAt = new Date();
        return true;
      }
    }
    return false;
  }

  async getPolicy(userId: string): Promise<UserMfaPolicyRow | null> {
    return this.policies.get(userId) ?? null;
  }

  async upsertPolicy(
    userId: string,
    patch: Partial<Omit<UserMfaPolicyRow, "userId" | "createdAt" | "updatedAt">>,
  ): Promise<UserMfaPolicyRow> {
    const now = new Date();
    const existing = this.policies.get(userId);
    const merged: UserMfaPolicyRow = existing
      ? {
          ...existing,
          hasWebauthn: patch.hasWebauthn ?? existing.hasWebauthn,
          hasTotp: patch.hasTotp ?? existing.hasTotp,
          recoveryCodesIssuedAt: patch.recoveryCodesIssuedAt ?? existing.recoveryCodesIssuedAt,
          enrollmentCompletedAt: patch.enrollmentCompletedAt ?? existing.enrollmentCompletedAt,
          lastVerifiedAt: patch.lastVerifiedAt ?? existing.lastVerifiedAt,
          lastVerifiedMethod: patch.lastVerifiedMethod ?? existing.lastVerifiedMethod,
          updatedAt: now,
        }
      : {
          userId,
          hasWebauthn: patch.hasWebauthn ?? false,
          hasTotp: patch.hasTotp ?? false,
          recoveryCodesIssuedAt: patch.recoveryCodesIssuedAt ?? null,
          enrollmentCompletedAt: patch.enrollmentCompletedAt ?? null,
          lastVerifiedAt: patch.lastVerifiedAt ?? null,
          lastVerifiedMethod: patch.lastVerifiedMethod ?? null,
          createdAt: now,
          updatedAt: now,
        };
    this.policies.set(userId, merged);
    return merged;
  }
}

let defaultRepo: MfaRepository | null = null;

export function getDefaultMfaRepository(): MfaRepository {
  if (defaultRepo) return defaultRepo;
  defaultRepo = isPostgresPersistenceEnabled()
    ? new PostgresMfaRepository()
    : new InMemoryMfaRepository();
  return defaultRepo;
}

export function setDefaultMfaRepositoryForTests(repo: MfaRepository | null): void {
  defaultRepo = repo;
}
