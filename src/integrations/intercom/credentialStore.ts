import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";
import { SharedCredentialStore } from "../shared/sharedCredentialStore";
import {
  IntercomAuthMethod,
  IntercomCredential,
  IntercomCredentialPublic,
} from "./types";

/**
 * HEL-470 (B11): Intercom credentials are now persisted durably (encrypted) via
 * the shared `connector_credentials` Postgres table + key-versioned vault,
 * instead of a process-local `new Map<>()` that lost every connection on restart
 * and was invisible on the other Fly machine.
 *
 * The service layer still consumes the legacy `IntercomCredential` shape (with
 * `tokenEncrypted` / `refreshTokenEncrypted` fields) and `decryptAccessToken`/
 * `decryptRefreshToken` helpers. To preserve that contract without rewriting the
 * whole service, `getActiveByUser*` reconstruct an `IntercomCredential` from the
 * vault's decrypted secrets, re-wrapping the tokens with a *transient* cipher.
 * That transient round-trip never leaves the process, so a random key when
 * `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` is unset is harmless here — the durable
 * at-rest encryption is the vault's stable key, not this one.
 */
const TRANSIENT_KEY: Buffer = (() => {
  const envKey = process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY;
  if (envKey) {
    return scryptSync(envKey, "autoflow-connector-salt", 32) as Buffer;
  }
  return randomBytes(32);
})();

function transientEncrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", TRANSIENT_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function transientDecrypt(ciphertext: string): string {
  const [ivHex, tagHex, dataHex] = ciphertext.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Invalid ciphertext format");
  }
  const decipher = createDecipheriv("aes-256-gcm", TRANSIENT_KEY, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(dataHex, "hex")).toString("utf8") + decipher.final("utf8");
}

interface IntercomCredentialMetadata {
  authMethod: IntercomAuthMethod;
  tokenMasked: string;
  scopes: string[];
  workspaceId: string;
  workspaceName?: string;
  /** Legacy free-form metadata (e.g. expiresAt, viewerId). */
  extra?: Record<string, string>;
}

interface IntercomCredentialSecrets {
  accessToken: string;
  refreshToken?: string;
}

type IntercomRecord = {
  id: string;
  userId: string;
  label: string;
  authMethod: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  metadata: IntercomCredentialMetadata;
};

const store = new SharedCredentialStore<
  IntercomCredentialMetadata,
  IntercomCredentialSecrets
>({ service: "intercom" });

function maskToken(value: string): string {
  return `****${value.slice(-4)}`;
}

function toPublic(record: IntercomRecord): IntercomCredentialPublic {
  return {
    id: record.id,
    userId: record.userId,
    authMethod: record.metadata.authMethod,
    tokenMasked: record.metadata.tokenMasked,
    scopes: record.metadata.scopes,
    workspaceId: record.metadata.workspaceId,
    workspaceName: record.metadata.workspaceName,
    createdAt: record.createdAt,
    revokedAt: record.revokedAt,
  };
}

/** Rebuild the legacy IntercomCredential (with transient-encrypted tokens). */
function toFullCredential(
  record: IntercomRecord,
  secrets: IntercomCredentialSecrets,
): IntercomCredential {
  return {
    id: record.id,
    userId: record.userId,
    authMethod: record.metadata.authMethod,
    tokenEncrypted: transientEncrypt(secrets.accessToken),
    tokenMasked: record.metadata.tokenMasked,
    refreshTokenEncrypted: secrets.refreshToken
      ? transientEncrypt(secrets.refreshToken)
      : undefined,
    scopes: record.metadata.scopes,
    workspaceId: record.metadata.workspaceId,
    workspaceName: record.metadata.workspaceName,
    createdAt: record.createdAt,
    revokedAt: record.revokedAt,
    metadata: record.metadata.extra,
  };
}

/**
 * Supersede any existing non-revoked credential for the same user+workspace.
 * Hydrates the user's durable rows first (HEL-470 Codex P2): on a cold instance
 * the local bucket is empty, so without this a reconnect wouldn't see/delete the
 * persisted credential and would leave duplicate active creds for the same
 * user/workspace. `delete()` durably removes the row once it's in the bucket.
 */
async function supersedeExisting(userId: string, workspaceId: string): Promise<void> {
  const records = await store.listByUserAsync(userId, false);
  for (const record of records) {
    if (record.metadata.workspaceId === workspaceId) {
      store.delete(record.id);
    }
  }
}

export const intercomCredentialStore = {
  async saveOAuth(params: {
    userId: string;
    accessToken: string;
    refreshToken?: string;
    scopes: string[];
    workspaceId: string;
    workspaceName?: string;
    metadata?: Record<string, string>;
  }): Promise<IntercomCredentialPublic> {
    await supersedeExisting(params.userId, params.workspaceId);
    const record = store.create({
      userId: params.userId,
      authMethod: "oauth2_pkce",
      label: params.workspaceName ?? params.workspaceId,
      metadata: {
        authMethod: "oauth2_pkce",
        tokenMasked: maskToken(params.accessToken),
        scopes: params.scopes,
        workspaceId: params.workspaceId,
        workspaceName: params.workspaceName,
        extra: params.metadata,
      },
      secrets: {
        accessToken: params.accessToken,
        refreshToken: params.refreshToken,
      },
    });
    return toPublic(record);
  },

  async saveApiKey(params: {
    userId: string;
    apiKey: string;
    scopes?: string[];
    workspaceId: string;
    workspaceName?: string;
    metadata?: Record<string, string>;
  }): Promise<IntercomCredentialPublic> {
    await supersedeExisting(params.userId, params.workspaceId);
    const record = store.create({
      userId: params.userId,
      authMethod: "api_key",
      label: params.workspaceName ?? params.workspaceId,
      metadata: {
        authMethod: "api_key",
        tokenMasked: maskToken(params.apiKey),
        scopes: params.scopes ?? [],
        workspaceId: params.workspaceId,
        workspaceName: params.workspaceName,
        extra: params.metadata,
      },
      secrets: {
        accessToken: params.apiKey,
      },
    });
    return toPublic(record);
  },

  async getPublicByUser(userId: string): Promise<IntercomCredentialPublic[]> {
    // Hydrate from Postgres under RLS so connection listings aren't empty on a
    // cold instance / after a restart (HEL-470 Codex P2).
    const records = await store.listByUserAsync(userId, true);
    return records.map(toPublic);
  },

  /**
   * Sync getter — reads this process's local bucket only (no Postgres). Used by
   * the unified connection-status/disconnect bridge for parity with the other
   * (not-yet-migrated) connectors. Durable hot paths (health, ensureValidCredential,
   * connection listing, disconnect) use the async variants.
   */
  getActiveByUser(userId: string): IntercomCredential | null {
    const record = store.findLatest((r) => r.userId === userId, false);
    if (!record) return null;
    const decrypted = store.getDecrypted(record.id);
    if (!decrypted) return null;
    return toFullCredential(decrypted.record, decrypted.secrets);
  },

  /** Durable getter — re-hydrates from Postgres when the bucket is cold. */
  async getActiveByUserAsync(userId: string): Promise<IntercomCredential | null> {
    // Must use the user-scoped list: it queries Postgres under RLS and
    // re-hydrates after a restart / on the other instance. `findLatestAsync`
    // only reads this process's local bucket, so it would return null for a
    // durable credential this process hasn't loaded yet (HEL-470 Codex P1).
    const records = await store.listByUserAsync(userId, false);
    if (records.length === 0) return null;
    const latest = records.reduce((a, b) =>
      b.createdAt.localeCompare(a.createdAt) > 0 ? b : a,
    );
    const decrypted = await store.getDecryptedAsync(latest.id, userId);
    if (!decrypted) return null;
    return toFullCredential(decrypted.record, decrypted.secrets);
  },

  decryptAccessToken(credential: IntercomCredential): string {
    return transientDecrypt(credential.tokenEncrypted);
  },

  decryptRefreshToken(credential: IntercomCredential): string | null {
    if (!credential.refreshTokenEncrypted) return null;
    return transientDecrypt(credential.refreshTokenEncrypted);
  },

  rotateToken(params: {
    credentialId: string;
    accessToken: string;
    refreshToken?: string;
    scopes?: string[];
    expiresAt?: string;
  }): IntercomCredentialPublic | null {
    const updated = store.update(params.credentialId, (existing, secrets) => {
      if (existing.revokedAt) return {};
      return {
        record: {
          ...existing,
          updatedAt: new Date().toISOString(),
          metadata: {
            ...existing.metadata,
            tokenMasked: maskToken(params.accessToken),
            scopes: params.scopes ?? existing.metadata.scopes,
            extra: {
              ...(existing.metadata.extra ?? {}),
              ...(params.expiresAt ? { expiresAt: params.expiresAt } : {}),
            },
          },
        },
        secrets: {
          accessToken: params.accessToken,
          refreshToken: params.refreshToken ?? secrets.refreshToken,
        },
      };
    });
    if (!updated || updated.revokedAt) return null;
    return toPublic(updated);
  },

  async revoke(credentialId: string, userId: string): Promise<boolean> {
    // getByIdAsync hydrates from Postgres under RLS (ownership enforced), so a
    // credential persisted by another instance can actually be disconnected
    // (HEL-470 Codex P2). getById (bucket-only) would 404 on a cold instance.
    const existing = await store.getByIdAsync(credentialId, userId);
    if (!existing || existing.revokedAt) {
      return false;
    }
    const now = new Date().toISOString();
    store.update(credentialId, (record, secrets) => ({
      record: { ...record, updatedAt: now, revokedAt: now },
      secrets,
    }));
    return true;
  },

  clear(): void {
    store.clear();
  },
};
