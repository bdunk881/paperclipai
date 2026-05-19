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
 * Encryption envelope (AES-256-GCM with the
 * INTEGRATION_CREDENTIAL_ENCRYPTION_KEY env var) is unchanged — the
 * ciphertext rides inside the JSON `record_data` blob. This is
 * intentionally NOT the CentralCredentialStore key envelope so that the
 * encryption-at-rest properties of existing in-memory data don't
 * silently change at deploy time. A future migration can move us onto
 * the connectorSecretVault rotation pattern once we have a backfill plan.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";
import { randomUUID } from "node:crypto";
import { getPostgresPool, inMemoryAllowed, isPostgresPersistenceEnabled } from "../db/postgres";
import {
  IntegrationConnection,
  IntegrationConnectionPublic,
  IntegrationCredentials,
} from "./integrationManifest";

// ---------------------------------------------------------------------------
// Encryption helpers (AES-256-GCM)
// ---------------------------------------------------------------------------

const ENCRYPTION_KEY: Buffer = (() => {
  const envKey = process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY ?? process.env.LLM_CONFIG_ENCRYPTION_KEY;
  if (envKey) {
    return scryptSync(envKey, "autoflow-integration-salt", 32) as Buffer;
  }
  // Dev/test fallback — not portable across process restarts
  return randomBytes(32);
})();

function encryptCredentials(credentials: IntegrationCredentials): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const plaintext = JSON.stringify(credentials);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptCredentials(ciphertext: string): IntegrationCredentials {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid credential ciphertext format");
  const [ivHex, tagHex, encHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const enc = Buffer.from(encHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  decipher.setAuthTag(tag);
  const plaintext = decipher.update(enc).toString("utf8") + decipher.final("utf8");
  return JSON.parse(plaintext) as IntegrationCredentials;
}

// ---------------------------------------------------------------------------
// Persistence layer (connector_credentials, service='integration_connection')
// ---------------------------------------------------------------------------

const SERVICE_KEY = "integration_connection";
const cache = new Map<string, IntegrationConnection>();

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
}

function toRecord(conn: IntegrationConnection): PersistedRecord {
  return {
    userId: conn.userId,
    integrationSlug: conn.integrationSlug,
    label: conn.label,
    isDefault: conn.isDefault,
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
    credentialsEncrypted: conn.credentialsEncrypted,
  };
}

function fromRow(row: { id: string; record_data: unknown }): IntegrationConnection {
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
  };
}

async function persistConnection(conn: IntegrationConnection): Promise<void> {
  if (!postgresAvailable()) return;
  await getPostgresPool().query(
    `INSERT INTO connector_credentials (service, id, user_id, created_at, record_data)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (service, id) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           record_data = EXCLUDED.record_data`,
    [SERVICE_KEY, conn.id, conn.userId, conn.createdAt, JSON.stringify(toRecord(conn))],
  );
}

async function loadById(id: string): Promise<IntegrationConnection | undefined> {
  if (!postgresAvailable()) return undefined;
  const result = await getPostgresPool().query<{ id: string; record_data: unknown }>(
    `SELECT id, record_data FROM connector_credentials WHERE service = $1 AND id = $2`,
    [SERVICE_KEY, id],
  );
  return result.rows[0] ? fromRow(result.rows[0]) : undefined;
}

async function loadByUser(userId: string): Promise<IntegrationConnection[]> {
  if (!postgresAvailable()) return [];
  const result = await getPostgresPool().query<{ id: string; record_data: unknown }>(
    `SELECT id, record_data FROM connector_credentials
      WHERE service = $1 AND user_id = $2 AND revoked_at IS NULL
      ORDER BY created_at DESC`,
    [SERVICE_KEY, userId],
  );
  return result.rows.map(fromRow);
}

async function deletePersisted(id: string): Promise<void> {
  if (!postgresAvailable()) return;
  await getPostgresPool().query(
    `DELETE FROM connector_credentials WHERE service = $1 AND id = $2`,
    [SERVICE_KEY, id],
  );
}

function toPublic(conn: IntegrationConnection): IntegrationConnectionPublic {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { credentialsEncrypted: _enc, ...pub } = conn;
  return pub;
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
    const conn: IntegrationConnection = {
      id: randomUUID(),
      userId: params.userId,
      integrationSlug: params.integrationSlug,
      label: params.label,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
      credentialsEncrypted: encryptCredentials(params.credentials),
    };
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
    const persisted = await loadById(id);
    if (!persisted || persisted.userId !== userId) return undefined;
    cache.set(persisted.id, persisted);
    return toPublic(persisted);
  },

  async update(
    id: string,
    userId: string,
    patch: { label?: string },
  ): Promise<IntegrationConnectionPublic | undefined> {
    const existing = cache.get(id) ?? (await loadById(id));
    if (!existing || existing.userId !== userId) return undefined;
    const updated: IntegrationConnection = {
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
    const existing = cache.get(id) ?? (await loadById(id));
    if (!existing || existing.userId !== userId) return false;
    const current = decryptCredentials(existing.credentialsEncrypted);
    const merged: IntegrationCredentials = { ...current, ...credentials };
    const updated: IntegrationConnection = {
      ...existing,
      credentialsEncrypted: encryptCredentials(merged),
      updatedAt: new Date().toISOString(),
    };
    cache.set(id, updated);
    await persistConnection(updated);
    return true;
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const existing = cache.get(id) ?? (await loadById(id));
    if (!existing || existing.userId !== userId) return false;
    cache.delete(id);
    await deletePersisted(id);
    return true;
  },

  async setDefault(
    id: string,
    userId: string,
  ): Promise<IntegrationConnectionPublic | undefined> {
    const target = cache.get(id) ?? (await loadById(id));
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
        const cleared = { ...conn, isDefault: false, updatedAt: new Date().toISOString() };
        cache.set(conn.id, cleared);
        await persistConnection(cleared);
      }
    }

    const updated: IntegrationConnection = {
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
    const conn = cache.get(id) ?? (await loadById(id));
    if (!conn || conn.userId !== userId) return undefined;
    cache.set(conn.id, conn);
    return {
      connection: toPublic(conn),
      credentials: decryptCredentials(conn.credentialsEncrypted),
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
    return {
      connection: toPublic(defaultConn),
      credentials: decryptCredentials(defaultConn.credentialsEncrypted),
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
};
