import { parseJsonColumn } from "../../db/json";
import { inMemoryAllowed, isPostgresConfigured, queryPostgres } from "../../db/postgres";
import { KeyVersionedSecretVault } from "../../secrets/keyVersionedSecretVault";

export interface CredentialRegistryRecord {
  id: string;
  userId: string;
  createdAt: string;
  revokedAt?: string;
  keyVersion?: number;
}

interface SecretVaultOptions {
  currentKeyEnvVars: string[];
  previousKeyEnvVars?: string[];
  v2KeyEnvVars?: string[];
  salts?: string[];
}

function inferEncryptedFieldVersions(record: unknown, secretVault: SecretVault): number[] {
  if (typeof record !== "object" || record === null) {
    return [];
  }

  const versions: number[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" && key.endsWith("Encrypted")) {
      try {
        versions.push(secretVault.getCiphertextKeyVersion(value));
      } catch {
        // Some tests and legacy in-memory paths use placeholder encrypted
        // values. Decryption still fails later; persistence should not throw
        // while merely computing row-level rotation metadata.
      }
      continue;
    }

    if (typeof value === "object" && value !== null) {
      versions.push(...inferEncryptedFieldVersions(value, secretVault));
    }
  }

  return versions;
}

function inferRecordKeyVersion(record: CredentialRegistryRecord, secretVault: SecretVault): number {
  const versions = inferEncryptedFieldVersions(record, secretVault);
  if (versions.length === 0) {
    return record.keyVersion ?? secretVault.getActiveKeyVersion();
  }

  return Math.min(...versions);
}

export class SecretVault extends KeyVersionedSecretVault {
  constructor(options: SecretVaultOptions) {
    super({ ...options, keyLabel: "connector credential" });
  }
}

export const connectorSecretVault = new SecretVault({
  currentKeyEnvVars: [
    "CONNECTOR_CREDENTIAL_ENCRYPTION_KEY",
    "CONNECTOR_CREDENTIALS_ENCRYPTION_KEY",
    "LLM_CONFIG_ENCRYPTION_KEY",
  ],
  previousKeyEnvVars: [
    "CONNECTOR_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS",
    "CONNECTOR_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS",
    "CONNECTOR_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS_KEYS",
    "CONNECTOR_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS_KEYS",
  ],
  v2KeyEnvVars: [
    "CONNECTOR_CREDENTIAL_ENCRYPTION_KEY_V2",
    "CONNECTOR_CREDENTIALS_ENCRYPTION_KEY_V2",
    "LLM_CONFIG_ENCRYPTION_KEY_V2",
  ],
  salts: ["autoflow-connector-salt", "autoflow-connectors-salt"],
});

export function maskSecret(value: string): string {
  return `****${value.slice(-4)}`;
}

// allowlist: rolling counter / cached config; process-local by design
const registryBuckets = new Map<string, Map<string, unknown>>();

function getBucket<TRecord>(service: string): Map<string, TRecord> {
  const existing = registryBuckets.get(service);
  if (existing) {
    return existing as Map<string, TRecord>;
  }

  const created = new Map<string, TRecord>();
  registryBuckets.set(service, created as Map<string, unknown>);
  return created;
}

interface CredentialRegistryOptions<TStored extends CredentialRegistryRecord, TPublic> {
  service: string;
  toPublic: (record: TStored) => TPublic;
  sortValue?: (record: TStored) => string;
  secretVault?: SecretVault;
}

interface PersistedCredentialRegistryRow {
  id: string;
  user_id: string;
  record_data: unknown;
  key_version?: number;
}

function mergeStoredRecords<TStored extends CredentialRegistryRecord>(
  local: TStored[],
  persisted: TStored[],
  sortValue: (record: TStored) => string
): TStored[] {
  const merged = new Map<string, TStored>();

  for (const record of persisted) {
    merged.set(record.id, record);
  }

  for (const record of local) {
    merged.set(record.id, record);
  }

  return Array.from(merged.values()).sort((a, b) => sortValue(b).localeCompare(sortValue(a)));
}

export class CredentialRegistry<TStored extends CredentialRegistryRecord, TPublic> {
  private readonly bucket: Map<string, TStored>;

  private readonly toPublicMapper: (record: TStored) => TPublic;

  private readonly sortValue: (record: TStored) => string;

  private readonly secretVault: SecretVault;

  private readonly service: string;

  constructor(options: CredentialRegistryOptions<TStored, TPublic>) {
    this.service = options.service;
    this.bucket = getBucket<TStored>(options.service);
    this.toPublicMapper = options.toPublic;
    this.sortValue = options.sortValue ?? ((record) => record.createdAt);
    this.secretVault = options.secretVault ?? connectorSecretVault;
  }

  private postgresPersistenceAvailable(): boolean {
    if (isPostgresConfigured()) {
      return true;
    }
    if (inMemoryAllowed()) {
      return false;
    }
    throw new Error(`credentialRegistry:${this.service} requires DATABASE_URL outside development/test.`);
  }

  save(record: TStored): TStored {
    const usePostgres = this.postgresPersistenceAvailable();
    const recordWithKeyVersion = {
      ...record,
      keyVersion: inferRecordKeyVersion(record, this.secretVault),
    };
    this.bucket.set(record.id, recordWithKeyVersion);
    if (usePostgres) {
      void this.persistRecord(recordWithKeyVersion).catch((error) => {
        console.error(`[credentialRegistry:${this.service}] Failed to persist credential`, error);
      });
    }
    return recordWithKeyVersion;
  }

  listPublicByUser(userId: string, includeRevoked = true): TPublic[] {
    return this.listStoredByUser(userId, includeRevoked).map((record) => this.toPublicMapper(record));
  }

  listStoredByUser(userId: string, includeRevoked = true): TStored[] {
    return this.listStored((record) => record.userId === userId, includeRevoked);
  }

  listStored(predicate: (record: TStored) => boolean, includeRevoked = true): TStored[] {
    return Array.from(this.bucket.values()).filter((record) => {
      if (!includeRevoked && record.revokedAt) {
        return false;
      }
      return predicate(record);
    });
  }

  getById(id: string): TStored | null {
    return this.bucket.get(id) ?? null;
  }

  async getByIdAsync(id: string): Promise<TStored | null> {
    const local = this.getById(id);
    if (local || !this.postgresPersistenceAvailable()) {
      return local;
    }

    const result = await queryPostgres<PersistedCredentialRegistryRow>(
      "SELECT id, user_id, record_data, key_version FROM connector_credentials WHERE service = $1 AND id = $2",
      [this.service, id]
    );
    const row = result.rows[0];
    return row ? this.mapPersistedRecord(row) : null;
  }

  findLatest(predicate: (record: TStored) => boolean, includeRevoked = false): TStored | null {
    const matches = this.listStored(predicate, includeRevoked).sort((a, b) =>
      this.sortValue(b).localeCompare(this.sortValue(a))
    );
    return matches[0] ?? null;
  }

  async findLatestAsync(
    predicate: (record: TStored) => boolean,
    includeRevoked = false
  ): Promise<TStored | null> {
    const matches = (await this.listStoredAsync(includeRevoked))
      .filter(predicate)
      .sort((a, b) => this.sortValue(b).localeCompare(this.sortValue(a)));
    return matches[0] ?? null;
  }

  update(id: string, mutate: (record: TStored) => TStored): TStored | null {
    const usePostgres = this.postgresPersistenceAvailable();
    const existing = this.bucket.get(id);
    if (!existing) {
      return null;
    }

    const updated = mutate(existing);
    const updatedWithKeyVersion = {
      ...updated,
      keyVersion: inferRecordKeyVersion(updated, this.secretVault),
    };
    this.bucket.set(id, updatedWithKeyVersion);
    if (usePostgres) {
      void this.persistRecord(updatedWithKeyVersion).catch((error) => {
        console.error(`[credentialRegistry:${this.service}] Failed to persist credential update`, error);
      });
    }
    return updatedWithKeyVersion;
  }

  purge(predicate: (record: TStored) => boolean): void {
    const usePostgres = this.postgresPersistenceAvailable();
    const deletedIds: string[] = [];
    for (const [id, record] of this.bucket.entries()) {
      if (predicate(record)) {
        this.bucket.delete(id);
        deletedIds.push(id);
      }
    }

    if (usePostgres && deletedIds.length > 0) {
      void this.deletePersistedRecords(deletedIds).catch((error) => {
        console.error(`[credentialRegistry:${this.service}] Failed to delete persisted credentials`, error);
      });
    }
  }

  clear(): void {
    this.bucket.clear();
  }

  async listPublicByUserAsync(userId: string, includeRevoked = true): Promise<TPublic[]> {
    return (await this.listStoredByUserAsync(userId, includeRevoked)).map((record) =>
      this.toPublicMapper(record)
    );
  }

  async listStoredByUserAsync(userId: string, includeRevoked = true): Promise<TStored[]> {
    return (await this.listStoredAsync(includeRevoked)).filter((record) => record.userId === userId);
  }

  async listStoredAsync(includeRevoked = true): Promise<TStored[]> {
    const local = Array.from(this.bucket.values()).filter((record) =>
      includeRevoked ? true : !record.revokedAt
    );
    if (!this.postgresPersistenceAvailable()) {
      return local.sort((a, b) => this.sortValue(b).localeCompare(this.sortValue(a)));
    }

    const result = await queryPostgres<PersistedCredentialRegistryRow>(
      "SELECT id, user_id, record_data, key_version FROM connector_credentials WHERE service = $1 ORDER BY created_at DESC",
      [this.service]
    );
    const persisted = result.rows
      .map((row: PersistedCredentialRegistryRow) => this.mapPersistedRecord(row))
      .filter((record: TStored) => (includeRevoked ? true : !record.revokedAt));
    return mergeStoredRecords(local, persisted, this.sortValue);
  }

  toPublic(record: TStored): TPublic {
    return this.toPublicMapper(record);
  }

  encryptSecret(plaintext: string): string {
    return this.secretVault.encrypt(plaintext);
  }

  decryptSecret(ciphertext: string): string {
    return this.secretVault.decrypt(ciphertext);
  }

  getActiveKeyVersion(): number {
    return this.secretVault.getActiveKeyVersion();
  }

  private mapPersistedRecord(row: PersistedCredentialRegistryRow): TStored {
    const record = parseJsonColumn(row.record_data, null as TStored | null);
    if (!record) {
      throw new Error(`Persisted credential ${this.service}/${row.id} is missing record_data`);
    }

    if (record.keyVersion === undefined && row.key_version !== undefined) {
      record.keyVersion = row.key_version;
    }
    this.bucket.set(record.id, record);
    return record;
  }

  private async persistRecord(record: TStored): Promise<void> {
    if (!this.postgresPersistenceAvailable()) {
      return;
    }

    const keyVersion = record.keyVersion ?? inferRecordKeyVersion(record, this.secretVault);
    const recordWithKeyVersion = { ...record, keyVersion };

    await queryPostgres(
      `INSERT INTO connector_credentials (
        service,
        id,
        user_id,
        created_at,
        revoked_at,
        record_data,
        key_version
      ) VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::jsonb, $7)
      ON CONFLICT (service, id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        created_at = EXCLUDED.created_at,
        revoked_at = EXCLUDED.revoked_at,
        record_data = EXCLUDED.record_data,
        key_version = EXCLUDED.key_version`,
      [
        this.service,
        record.id,
        record.userId,
        record.createdAt,
        record.revokedAt ?? null,
        JSON.stringify(recordWithKeyVersion),
        keyVersion,
      ]
    );
  }

  private async deletePersistedRecords(ids: string[]): Promise<void> {
    if (ids.length === 0 || !this.postgresPersistenceAvailable()) {
      return;
    }

    await queryPostgres(
      "DELETE FROM connector_credentials WHERE service = $1 AND id = ANY($2::text[])",
      [this.service, ids]
    );
  }
}
