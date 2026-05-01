/**
 * Integration Credential Vault — per-user, per-integration encrypted credential storage.
 *
 * Credentials (tokens, API keys, OAuth2 access/refresh pairs, etc.) are
 * encrypted at rest with AES-256-GCM using the same approach as llmConfigStore.
 *
 * Replace the in-memory Map with a database-backed store for production.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";
import { randomUUID } from "node:crypto";
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
// In-memory store
// ---------------------------------------------------------------------------

const store = new Map<string, IntegrationConnection>();

function toPublic(conn: IntegrationConnection): IntegrationConnectionPublic {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { credentialsEncrypted: _enc, ...pub } = conn;
  return pub;
}

// ---------------------------------------------------------------------------
// Store API
// ---------------------------------------------------------------------------

export const integrationCredentialStore = {
  /**
   * Save a new integration connection with encrypted credentials.
   * Returns the public (credential-stripped) record.
   */
  create(params: {
    userId: string;
    integrationSlug: string;
    label: string;
    credentials: IntegrationCredentials;
  }): IntegrationConnectionPublic {
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
    store.set(conn.id, conn);
    return toPublic(conn);
  },

  /** List all connections for a user (optionally filtered by integration). */
  list(userId: string, integrationSlug?: string): IntegrationConnectionPublic[] {
    return Array.from(store.values())
      .filter(
        (c) =>
          c.userId === userId &&
          (!integrationSlug || c.integrationSlug === integrationSlug)
      )
      .map(toPublic);
  },

  /** Get a single connection (public view) by ID, scoped to the user. */
  get(id: string, userId: string): IntegrationConnectionPublic | undefined {
    const conn = store.get(id);
    if (!conn || conn.userId !== userId) return undefined;
    return toPublic(conn);
  },

  /** Update the label of a connection. */
  update(
    id: string,
    userId: string,
    patch: { label?: string }
  ): IntegrationConnectionPublic | undefined {
    const conn = store.get(id);
    if (!conn || conn.userId !== userId) return undefined;
    const updated: IntegrationConnection = {
      ...conn,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    store.set(id, updated);
    return toPublic(updated);
  },

  /** Update the stored credentials (e.g. after an OAuth2 token refresh). */
  updateCredentials(
    id: string,
    userId: string,
    credentials: Partial<IntegrationCredentials>
  ): boolean {
    const conn = store.get(id);
    if (!conn || conn.userId !== userId) return false;
    const current = decryptCredentials(conn.credentialsEncrypted);
    const merged: IntegrationCredentials = { ...current, ...credentials };
    store.set(id, {
      ...conn,
      credentialsEncrypted: encryptCredentials(merged),
      updatedAt: new Date().toISOString(),
    });
    return true;
  },

  /** Delete a connection by ID. */
  delete(id: string, userId: string): boolean {
    const conn = store.get(id);
    if (!conn || conn.userId !== userId) return false;
    store.delete(id);
    return true;
  },

  /** Mark a connection as the user's default for its integration. */
  setDefault(id: string, userId: string): IntegrationConnectionPublic | undefined {
    const target = store.get(id);
    if (!target || target.userId !== userId) return undefined;

    // Clear existing default for this user + integration
    for (const conn of store.values()) {
      if (
        conn.userId === userId &&
        conn.integrationSlug === target.integrationSlug &&
        conn.isDefault
      ) {
        store.set(conn.id, { ...conn, isDefault: false });
      }
    }

    const updated: IntegrationConnection = { ...target, isDefault: true };
    store.set(id, updated);
    return toPublic(updated);
  },

  /**
   * Return decrypted credentials for a connection.
   * Used internally by the action executor and auth adapters.
   */
  getDecrypted(
    id: string,
    userId: string
  ): { connection: IntegrationConnectionPublic; credentials: IntegrationCredentials } | undefined {
    const conn = store.get(id);
    if (!conn || conn.userId !== userId) return undefined;
    return {
      connection: toPublic(conn),
      credentials: decryptCredentials(conn.credentialsEncrypted),
    };
  },

  /**
   * Return the user's default connection + decrypted credentials for an integration.
   */
  getDecryptedDefault(
    userId: string,
    integrationSlug: string
  ): { connection: IntegrationConnectionPublic; credentials: IntegrationCredentials } | undefined {
    for (const conn of store.values()) {
      if (
        conn.userId === userId &&
        conn.integrationSlug === integrationSlug &&
        conn.isDefault
      ) {
        return {
          connection: toPublic(conn),
          credentials: decryptCredentials(conn.credentialsEncrypted),
        };
      }
    }
    return undefined;
  },

  /** Clear all stored connections (test helper). */
  clear(): void {
    store.clear();
  },
};
