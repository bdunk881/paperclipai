import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { AgentCatalogConnection, AgentCatalogConnectionPublic, AgentCatalogProvider } from "./types";

const ENCRYPTION_KEY: Buffer = (() => {
  const envKey = process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY;
  if (envKey) {
    return scryptSync(envKey, "autoflow-connector-salt", 32) as Buffer;
  }
  return randomBytes(32);
})();

function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decrypt(ciphertext: string): string {
  const [ivHex, tagHex, dataHex] = ciphertext.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Invalid ciphertext format");
  }
  const decipher = createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(dataHex, "hex")).toString("utf8") + decipher.final("utf8");
}

interface StoredConnection extends AgentCatalogConnection {
  tokenEncrypted: string;
  refreshTokenEncrypted?: string;
}

const store = new Map<string, StoredConnection>();

function maskToken(value: string): string {
  return `****${value.slice(-4)}`;
}

function toPublic(connection: StoredConnection): AgentCatalogConnectionPublic {
  return {
    id: connection.id,
    userId: connection.userId,
    provider: connection.provider,
    authMethod: connection.authMethod,
    accountLabel: connection.accountLabel,
    tokenMasked: connection.tokenMasked,
    scopes: connection.scopes,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    revokedAt: connection.revokedAt,
  };
}

function findActiveByUserProvider(userId: string, provider: AgentCatalogProvider): StoredConnection | null {
  const active = Array.from(store.values())
    .filter((entry) => entry.userId === userId && entry.provider === provider && !entry.revokedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return active[0] ?? null;
}

export const agentCatalogCredentialStore = {
  saveOAuth(params: {
    userId: string;
    provider: AgentCatalogProvider;
    accessToken: string;
    refreshToken?: string;
    scopes: string[];
    accountLabel: string;
  }): AgentCatalogConnectionPublic {
    const existing = findActiveByUserProvider(params.userId, params.provider);
    if (existing) {
      store.set(existing.id, {
        ...existing,
        tokenEncrypted: encrypt(params.accessToken),
        refreshTokenEncrypted: params.refreshToken ? encrypt(params.refreshToken) : existing.refreshTokenEncrypted,
        tokenMasked: maskToken(params.accessToken),
        scopes: params.scopes,
        accountLabel: params.accountLabel,
        updatedAt: new Date().toISOString(),
      });
      return toPublic(store.get(existing.id)!);
    }

    const now = new Date().toISOString();
    const created: StoredConnection = {
      id: uuidv4(),
      userId: params.userId,
      provider: params.provider,
      authMethod: "oauth2_pkce",
      accountLabel: params.accountLabel,
      tokenMasked: maskToken(params.accessToken),
      scopes: params.scopes,
      tokenEncrypted: encrypt(params.accessToken),
      refreshTokenEncrypted: params.refreshToken ? encrypt(params.refreshToken) : undefined,
      createdAt: now,
      updatedAt: now,
    };
    store.set(created.id, created);
    return toPublic(created);
  },

  getPublicByUser(userId: string): AgentCatalogConnectionPublic[] {
    return Array.from(store.values())
      .filter((entry) => entry.userId === userId && !entry.revokedAt)
      .map(toPublic);
  },

  getActiveByUserProvider(userId: string, provider: AgentCatalogProvider): StoredConnection | null {
    return findActiveByUserProvider(userId, provider);
  },

  decryptAccessToken(connection: StoredConnection): string {
    return decrypt(connection.tokenEncrypted);
  },

  decryptRefreshToken(connection: StoredConnection): string | null {
    return connection.refreshTokenEncrypted ? decrypt(connection.refreshTokenEncrypted) : null;
  },

  revokeByProvider(userId: string, provider: AgentCatalogProvider): boolean {
    const existing = findActiveByUserProvider(userId, provider);
    if (!existing) return false;
    store.set(existing.id, {
      ...existing,
      revokedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return true;
  },

  clear(): void {
    store.clear();
  },
};
