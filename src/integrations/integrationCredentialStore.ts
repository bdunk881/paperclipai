/**
 * Integration Credential Vault — per-user, per-integration encrypted credential storage.
 *
 * DASH-49: every method is async and Postgres-backed via the canonical
 * `connector_credentials` table (migration 006), keyed by
 * `service = 'integration_connection'`. Pre-DASH-49 the entire store
 * lived in a single in-process Map — every Fly restart wiped every
 * connected OAuth integration in the workspace and users had to
 * re-authenticate. The Map stays as a hot-path read cache; cache miss
 * falls back to the database.
 *
 * HEL-454: new writes use the shared connectorSecretVault envelope, which
 * carries key-version metadata and supports `_V2` / `_PREVIOUS` rotation.
 * Existing rows that still contain the legacy integration AES-GCM envelope
 * can be read when the legacy key is configured; read/update paths rewrap
 * those rows into the connectorSecretVault envelope.
 */

import {
  createDecipheriv,
  randomUUID,
  scryptSync,
} from "node:crypto";
import { getPostgresPool, inMemoryAllowed, isPostgresPersistenceEnabled } from "../db/postgres";
import { withUserContext } from "../middleware/workspaceContext";
import {
  IntegrationConnection,
  IntegrationConnectionPublic,
  IntegrationCredentials,
} from "./integrationManifest";
import { connectorSecretVault } from "./shared/credentialRegistry";

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

type CredentialEnvelope = "connector_secret_vault" | "legacy_integration_aes_gcm";
type DecryptedCredentials = {
  credentials: IntegrationCredentials;
  envelope: CredentialEnvelope;
};

function encryptCredentials(credentials: IntegrationCredentials): string {
  return connectorSecretVault.encrypt(JSON.stringify(credentials));
}

function parseCredentialsPayload(plaintext: string): IntegrationCredentials {
  const parsed = JSON.parse(plaintext) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid integration credential payload");
  }
  return parsed as IntegrationCredentials;
}

function getLegacyCredentialKeys(): Buffer[] {
  const seeds = [
    process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY,
    process.env.LLM_CONFIG_ENCRYPTION_KEY,
  ]
    .flatMap((value) => (value ?? "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return seeds.map((seed) => scryptSync(seed, "autoflow-integration-salt", 32) as Buffer);
}

function decryptLegacyCredentials(ciphertext: string): IntegrationCredentials | null {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    return null;
  }

  const [ivHex, tagHex, encHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const enc = Buffer.from(encHex, "hex");
  for (const key of getLegacyCredentialKeys()) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const plaintext = decipher.update(enc).toString("utf8") + decipher.final("utf8");
      return parseCredentialsPayload(plaintext);
    } catch {
      continue;
    }
  }

  return null;
}

function decryptCredentials(ciphertext: string): DecryptedCredentials {
  try {
    return {
      credentials: parseCredentialsPayload(connectorSecretVault.decrypt(ciphertext)),
      envelope: "connector_secret_vault",
    };
  } catch (error) {
    const legacyCredentials = decryptLegacyCredentials(ciphertext);
    if (legacyCredentials) {
      return {
        credentials: legacyCredentials,
        envelope: "legacy_integration_aes_gcm",
      };
    }
    throw error;
  }
}
// ---------------------------------------------------------------------------
// Persistence layer (connector_credentials, service='integration_connection')
// ---------------------------------------------------------------------------

const SERVICE_KEY = "integration_connection";
interface IntegrationConnectionStored extends IntegrationConnection {
  keyVersion?: number;
}

// allowlist: hot-path read cache; canonical state lives in Postgres (DASH-47..51)
const cache = new Map<string, IntegrationConnectionStored>();

function postgresAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) return true;
  if (inMemoryAllowed()) return false;
  throw new Error("integrationCredentialStore requires DATABASE_URL outside development/test.");
}

interface PersistedRecord {
  userId: string;
  integrationSlug: string;
  label: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  credentialsEncrypted: string;
  encryptionEnvelope?: CredentialEnvelope;
  keyVersion?: number;
}

function getCiphertextKeyVersion(ciphertext: string): number {
  return connectorSecretVault.getCiphertextKeyVersion(ciphertext);
}

function getConnectorCiphertextKeyVersion(ciphertext: string): number | undefined {
  try {
    connectorSecretVault.decrypt(ciphertext);
    return connectorSecretVault.getCiphertextKeyVersion(ciphertext);
  } catch {
    return undefined;
  }
}

function toRecord(conn: IntegrationConnectionStored): PersistedRecord {
  const keyVersion = conn.keyVersion ?? getConnectorCiphertextKeyVersion(conn.credentialsEncrypted);
  return {
    userId: conn.userId,
    integrationSlug: conn.integrationSlug,
    label: conn.label,
    isDefault: conn.isDefault,
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
    credentialsEncrypted: conn.credentialsEncrypted,
    encryptionEnvelope: keyVersion === undefined ? "legacy_integration_aes_gcm" : "connector_secret_vault",
    keyVersion,
  };
}

function fromRow(row: { id: string; record_data: unknown; key_version?: number | null }): IntegrationConnectionStored {
  const data =
    typeof row.record_data === "string"
      ? (JSON.parse(row.record_data) as PersistedRecord)
      : (row.record_data as PersistedRecord);
  return {
    id: row.id,
    userId: data.userId,
    integrationSlug: data.integrationSlug,
    label: data.label,
    isDefault: data.isDefault,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    credentialsEncrypted: data.credentialsEncrypted,
    keyVersion: data.keyVersion ?? row.key_version ?? undefined,
  };
}

async function persistConnection(conn: IntegrationConnectionStored): Promise<void> {
  if (!postgresAvailable()) return;
  const record = toRecord(conn);
  await withUserContext(getPostgresPool(), conn.userId, async (client) => {
    await client.query(
      `INSERT INTO connector_credentials (service, id, user_id, created_at, record_data, key_version)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (service, id) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             record_data = EXCLUDED.record_data,
             key_version = EXCLUDED.key_version`,
      [SERVICE_KEY, conn.id, conn.userId, conn.createdAt, JSON.stringify(record), record.keyVersion ?? null],
    );
  });
}

async function loadById(userId: string, id: string): Promise<IntegrationConnectionStored | undefined> {
  if (!postgresAvailable()) return undefined;
  return withUserContext(getPostgresPool(), userId, async (client) => {
    const result = await client.query<{ id: string; record_data: unknown; key_version?: number | null }>(
      `SELECT id, record_data, key_version FROM connector_credentials WHERE service = $1 AND id = $2`,
      [SERVICE_KEY, id],
    );
    return result.rows[0] ? fromRow(result.rows[0]) : undefined;
  });
}

async function loadByUser(userId: string): Promise<IntegrationConnectionStored[]> {
  if (!postgresAvailable()) return [];
  return withUserContext(getPostgresPool(), userId, async (client) => {
    const result = await client.query<{ id: string; record_data: unknown; key_version?: number | null }>(
      `SELECT id, record_data, key_version FROM connector_credentials
        WHERE service = $1 AND user_id = $2 AND revoked_at IS NULL
        ORDER BY created_at DESC`,
      [SERVICE_KEY, userId],
    );
    return result.rows.map(fromRow);
  });
}

async function deletePersisted(userId: string, id: string): Promise<void> {
  if (!postgresAvailable()) return;
  await withUserContext(getPostgresPool(), userId, async (client) => {
    await client.query(
      `DELETE FROM connector_credentials WHERE service = $1 AND id = $2`,
      [SERVICE_KEY, id],
    );
  });
}

function toPublic(conn: IntegrationConnectionStored): IntegrationConnectionPublic {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { credentialsEncrypted: _enc, keyVersion: _keyVersion, ...pub } = conn;
  return pub;
}

function withEncryptedCredentials(
  conn: Omit<IntegrationConnectionStored, "credentialsEncrypted" | "keyVersion">,
  credentials: IntegrationCredentials,
): IntegrationConnectionStored {
  const credentialsEncrypted = encryptCredentials(credentials);
  return {
    ...conn,
    credentialsEncrypted,
    keyVersion: getCiphertextKeyVersion(credentialsEncrypted),
  };
}

async function decryptConnectionCredentials(
  conn: IntegrationConnectionStored,
): Promise<{ connection: IntegrationConnectionStored; credentials: IntegrationCredentials }> {
  const decrypted = decryptCredentials(conn.credentialsEncrypted);
  if (decrypted.envelope === "connector_secret_vault") {
    cache.set(conn.id, conn);
    return { connection: conn, credentials: decrypted.credentials };
  }

  const migrated = withEncryptedCredentials(
    {
      ...conn,
      updatedAt: new Date().toISOString(),
    },
    decrypted.credentials,
  );
  cache.set(migrated.id, migrated);
  await persistConnection(migrated);
  return { connection: migrated, credentials: decrypted.credentials };
}

// ---------------------------------------------------------------------------
// Store API
// ---------------------------------------------------------------------------

export const integrationCredentialStore = {
  async create(params: {
    userId: string;
    integrationSlug: string;
    label: string;
    credentials: IntegrationCredentials;
  }): Promise<IntegrationConnectionPublic> {
    const now = new Date().toISOString();
    const conn = withEncryptedCredentials(
      {
        id: randomUUID(),
        userId: params.userId,
        integrationSlug: params.integrationSlug,
        label: params.label,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      },
      params.credentials,
    );
    cache.set(conn.id, conn);
    await persistConnection(conn);
    return toPublic(conn);
  },

  async list(userId: string, integrationSlug?: string): Promise<IntegrationConnectionPublic[]> {
    // Postgres-first when available so post-restart reads see everything.
    // Falls back to the in-memory cache when in-memory mode is allowed
    // (tests and dev without DB) — otherwise the cross-record scan
    // returns nothing for every test that creates a record locally and
    // then lists.
    if (postgresAvailable()) {
      const persisted = await loadByUser(userId);
      for (const conn of persisted) {
        cache.set(conn.id, conn);
      }
      return persisted
        .filter((c) => !integrationSlug || c.integrationSlug === integrationSlug)
        .map(toPublic);
    }
    return Array.from(cache.values())
      .filter(
        (c) =>
          c.userId === userId && (!integrationSlug || c.integrationSlug === integrationSlug),
      )
      .map(toPublic);
  },

  async get(id: string, userId: string): Promise<IntegrationConnectionPublic | undefined> {
    const cached = cache.get(id);
    if (cached && cached.userId === userId) return toPublic(cached);
    const persisted = await loadById(userId, id);
    if (!persisted || persisted.userId !== userId) return undefined;
    cache.set(persisted.id, persisted);
    return toPublic(persisted);
  },

  async update(
    id: string,
    userId: string,
    patch: { label?: string },
  ): Promise<IntegrationConnectionPublic | undefined> {
    const existing = cache.get(id) ?? (await loadById(userId, id));
    if (!existing || existing.userId !== userId) return undefined;
    const updated: IntegrationConnectionStored = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    cache.set(id, updated);
    await persistConnection(updated);
    return toPublic(updated);
  },

  async updateCredentials(
    id: string,
    userId: string,
    credentials: Partial<IntegrationCredentials>,
  ): Promise<boolean> {
    const existing = cache.get(id) ?? (await loadById(userId, id));
    if (!existing || existing.userId !== userId) return false;
    const current = decryptCredentials(existing.credentialsEncrypted).credentials;
    const merged: IntegrationCredentials = { ...current, ...credentials };
    const credentialsEncrypted = encryptCredentials(merged);
    const updated: IntegrationConnectionStored = {
      ...existing,
      credentialsEncrypted,
      keyVersion: getCiphertextKeyVersion(credentialsEncrypted),
      updatedAt: new Date().toISOString(),
    };
    cache.set(id, updated);
    await persistConnection(updated);
    return true;
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const existing = cache.get(id) ?? (await loadById(userId, id));
    if (!existing || existing.userId !== userId) return false;
    cache.delete(id);
    await deletePersisted(userId, id);
    return true;
  },

  async setDefault(
    id: string,
    userId: string,
  ): Promise<IntegrationConnectionPublic | undefined> {
    const target = cache.get(id) ?? (await loadById(userId, id));
    if (!target || target.userId !== userId) return undefined;

    // Clear existing defaults for the same integration before flipping
    // this one to default. Pull the full list so we don't miss rows
    // that aren't in this process's cache.
    const allForUser = postgresAvailable()
      ? await loadByUser(userId)
      : Array.from(cache.values()).filter((c) => c.userId === userId);
    for (const conn of allForUser) {
      if (
        conn.id !== target.id &&
        conn.integrationSlug === target.integrationSlug &&
        conn.isDefault
      ) {
        const cleared: IntegrationConnectionStored = {
          ...conn,
          isDefault: false,
          updatedAt: new Date().toISOString(),
        };
        cache.set(conn.id, cleared);
        await persistConnection(cleared);
      }
    }

    const updated: IntegrationConnectionStored = {
      ...target,
      isDefault: true,
      updatedAt: new Date().toISOString(),
    };
    cache.set(id, updated);
    await persistConnection(updated);
    return toPublic(updated);
  },

  async getDecrypted(
    id: string,
    userId: string,
  ): Promise<
    | { connection: IntegrationConnectionPublic; credentials: IntegrationCredentials }
    | undefined
  > {
    const conn = cache.get(id) ?? (await loadById(userId, id));
    if (!conn || conn.userId !== userId) return undefined;
    const decrypted = await decryptConnectionCredentials(conn);
    return {
      connection: toPublic(decrypted.connection),
      credentials: decrypted.credentials,
    };
  },

  async getDecryptedDefault(
    userId: string,
    integrationSlug: string,
  ): Promise<
    | { connection: IntegrationConnectionPublic; credentials: IntegrationCredentials }
    | undefined
  > {
    const all = postgresAvailable()
      ? await loadByUser(userId)
      : Array.from(cache.values()).filter((c) => c.userId === userId);
    for (const conn of all) {
      cache.set(conn.id, conn);
    }
    const defaultConn = all.find(
      (c) => c.integrationSlug === integrationSlug && c.isDefault,
    );
    if (!defaultConn) return undefined;
    const decrypted = await decryptConnectionCredentials(defaultConn);
    return {
      connection: toPublic(decrypted.connection),
      credentials: decrypted.credentials,
    };
  },

  async clear(): Promise<void> {
    cache.clear();
    if (!postgresAvailable()) return;
    await getPostgresPool().query(
      `DELETE FROM connector_credentials WHERE service = $1`,
      [SERVICE_KEY],
    );
  },

  __unsafeGetCachedForTests(id: string): IntegrationConnectionStored | undefined {
    return cache.get(id);
  },

  __unsafeSetCachedForTests(connection: IntegrationConnectionStored): void {
    cache.set(connection.id, connection);
  },
};
