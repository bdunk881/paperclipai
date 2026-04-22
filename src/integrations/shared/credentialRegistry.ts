import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

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
    this.primaryKey = primarySeed
      ? deriveKeys([primarySeed], [salts[0]])[0]
      : randomBytes(32);

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

export class CredentialRegistry<TStored extends CredentialRegistryRecord, TPublic> {
  private readonly bucket: Map<string, TStored>;

  private readonly toPublicMapper: (record: TStored) => TPublic;

  private readonly sortValue: (record: TStored) => string;

  private readonly secretVault: SecretVault;

  constructor(options: CredentialRegistryOptions<TStored, TPublic>) {
    this.bucket = getBucket<TStored>(options.service);
    this.toPublicMapper = options.toPublic;
    this.sortValue = options.sortValue ?? ((record) => record.createdAt);
    this.secretVault = options.secretVault ?? connectorSecretVault;
  }

  save(record: TStored): TStored {
    this.bucket.set(record.id, record);
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

  findLatest(predicate: (record: TStored) => boolean, includeRevoked = false): TStored | null {
    const matches = this.listStored(predicate, includeRevoked).sort((a, b) =>
      this.sortValue(b).localeCompare(this.sortValue(a))
    );
    return matches[0] ?? null;
  }

  update(id: string, mutate: (record: TStored) => TStored): TStored | null {
    const existing = this.bucket.get(id);
    if (!existing) {
      return null;
    }

    const updated = mutate(existing);
    this.bucket.set(id, updated);
    return updated;
  }

  purge(predicate: (record: TStored) => boolean): void {
    for (const [id, record] of this.bucket.entries()) {
      if (predicate(record)) {
        this.bucket.delete(id);
      }
    }
  }

  clear(): void {
    this.bucket.clear();
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
}
