import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { parseJsonColumn } from "../../db/json";
import { isPostgresConfigured, queryPostgres } from "../../db/postgres";

export interface CredentialRegistryRecord {
  id: string;
  userId: string;
  createdAt: string;
  revokedAt?: string;
}

interface SecretVaultOptions {
  currentKeyEnvVars: string[];
  previousKeyEnvVars?: string[];
  salts?: string[];
}

const EPHEMERAL_KEY_ALLOWED_ENVS = new Set(["development", "test"]);

function parseEnvList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function deriveKeys(seeds: string[], salts: string[]): Buffer[] {
  const seen = new Set<string>();
  const keys: Buffer[] = [];

  for (const seed of seeds) {
    for (const salt of salts) {
      const cacheKey = `${seed}:${salt}`;
      if (seen.has(cacheKey)) {
        continue;
      }

      seen.add(cacheKey);
      keys.push(scryptSync(seed, salt, 32) as Buffer);
    }
  }

  return keys;
}

function getRuntimeEnvironment(): string {
  return (process.env.NODE_ENV ?? "development").trim().toLowerCase();
}

function createMissingEncryptionKeyError(currentKeyEnvVars: string[]): Error {
  const runtimeEnvironment = getRuntimeEnvironment();
  return new Error(
    `Missing connector credential encryption key for NODE_ENV=${runtimeEnvironment}. ` +
      `Set one of ${currentKeyEnvVars.join(", ")} before starting the server. ` +
      "Ephemeral random fallback is only allowed in development or test."
  );
}

export class SecretVault {
  private readonly primaryKey: Buffer;

  private readonly candidateKeys: Buffer[];

  constructor(options: SecretVaultOptions) {
    const salts = options.salts ?? ["autoflow-connector-salt"];
    const currentSeeds = options.currentKeyEnvVars.flatMap((envVar) => parseEnvList(process.env[envVar]));
    const previousSeeds = (options.previousKeyEnvVars ?? []).flatMap((envVar) =>
      parseEnvList(process.env[envVar])
    );

    const primarySeed = currentSeeds[0];
    if (!primarySeed) {
      const runtimeEnvironment = getRuntimeEnvironment();
      if (!EPHEMERAL_KEY_ALLOWED_ENVS.has(runtimeEnvironment)) {
        throw createMissingEncryptionKeyError(options.currentKeyEnvVars);
      }
    }

    this.primaryKey = primarySeed ? deriveKeys([primarySeed], [salts[0]])[0] : randomBytes(32);

    const candidateKeys = deriveKeys([...currentSeeds, ...previousSeeds], salts);
    this.candidateKeys = candidateKeys.length > 0 ? candidateKeys : [this.primaryKey];
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.primaryKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
  }

  decrypt(ciphertext: string): string {
    const [ivHex, tagHex, dataHex] = ciphertext.split(":");
    if (!ivHex || !tagHex || !dataHex) {
      throw new Error("Invalid ciphertext format");
    }

    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const data = Buffer.from(dataHex, "hex");

    for (const key of this.candidateKeys) {
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        return decipher.update(data).toString("utf8") + decipher.final("utf8");
      } catch {
        continue;
      }
    }

    throw new Error("Unable to decrypt secret with configured connector keys");
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
  salts: ["autoflow-connector-salt", "autoflow-connectors-salt"],
});

export function maskSecret(value: string): string {
  return `****${value.slice(-4)}`;
}

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
}

function isMissingCredentialRegistryTableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const pgError = error as Error & { code?: string };
  if (pgError.code === "42P01") {
    return true;
  }

  const message = error.message.toLowerCase();
  return message.includes("connector_credentials") && message.includes("does not exist");
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

  save(record: TStored): TStored {
    this.bucket.set(record.id, record);
    void this.persistRecord(record).catch((error) => {
      console.error(`[credentialRegistry:${this.service}] Failed to persist credential`, error);
    });
    return record;
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
    if (local || !isPostgresConfigured()) {
      return local;
    }

    let result;
    try {
      result = await queryPostgres<PersistedCredentialRegistryRow>(
        "SELECT id, user_id, record_data FROM connector_credentials WHERE service = $1 AND id = $2",
        [this.service, id]
      );
    } catch (error) {
      if (isMissingCredentialRegistryTableError(error)) {
        console.warn(
          `[credentialRegistry:${this.service}] connector_credentials table unavailable; using in-memory credentials only`
        );
        return local;
      }
      throw error;
    }

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
    const existing = this.bucket.get(id);
    if (!existing) {
      return null;
    }

    const updated = mutate(existing);
    this.bucket.set(id, updated);
    void this.persistRecord(updated).catch((error) => {
      console.error(`[credentialRegistry:${this.service}] Failed to persist credential update`, error);
    });
    return updated;
  }

  purge(predicate: (record: TStored) => boolean): void {
    const deletedIds: string[] = [];
    for (const [id, record] of this.bucket.entries()) {
      if (predicate(record)) {
        this.bucket.delete(id);
        deletedIds.push(id);
      }
    }

    if (deletedIds.length > 0) {
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
    if (!isPostgresConfigured()) {
      return local.sort((a, b) => this.sortValue(b).localeCompare(this.sortValue(a)));
    }

    let result;
    try {
      result = await queryPostgres<PersistedCredentialRegistryRow>(
        "SELECT id, user_id, record_data FROM connector_credentials WHERE service = $1 ORDER BY created_at DESC",
        [this.service]
      );
    } catch (error) {
      if (isMissingCredentialRegistryTableError(error)) {
        console.warn(
          `[credentialRegistry:${this.service}] connector_credentials table unavailable; using in-memory credentials only`
        );
        return local.sort((a, b) => this.sortValue(b).localeCompare(this.sortValue(a)));
      }
      throw error;
    }

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

  private mapPersistedRecord(row: PersistedCredentialRegistryRow): TStored {
    const record = parseJsonColumn(row.record_data, null as TStored | null);
    if (!record) {
      throw new Error(`Persisted credential ${this.service}/${row.id} is missing record_data`);
    }

    this.bucket.set(record.id, record);
    return record;
  }

  private async persistRecord(record: TStored): Promise<void> {
    if (!isPostgresConfigured()) {
      return;
    }

    await queryPostgres(
      `INSERT INTO connector_credentials (
        service,
        id,
        user_id,
        created_at,
        revoked_at,
        record_data
      ) VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::jsonb)
      ON CONFLICT (service, id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        created_at = EXCLUDED.created_at,
        revoked_at = EXCLUDED.revoked_at,
        record_data = EXCLUDED.record_data`,
      [
        this.service,
        record.id,
        record.userId,
        record.createdAt,
        record.revokedAt ?? null,
        JSON.stringify(record),
      ]
    );
  }

  private async deletePersistedRecords(ids: string[]): Promise<void> {
    if (!isPostgresConfigured() || ids.length === 0) {
      return;
    }

    await queryPostgres(
      "DELETE FROM connector_credentials WHERE service = $1 AND id = ANY($2::text[])",
      [this.service, ids]
    );
  }
}
