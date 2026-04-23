import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";
import { v4 as uuidv4 } from "uuid";
import {
  MonitoringCredential,
  MonitoringCredentialPublic,
  MonitoringProvider,
} from "./types";

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

  const decipher = createDecipheriv(
    "aes-256-gcm",
    ENCRYPTION_KEY,
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(dataHex, "hex")).toString("utf8") + decipher.final("utf8");
}

const store = new Map<string, MonitoringCredential>();

function toPublic(credential: MonitoringCredential): MonitoringCredentialPublic {
  return {
    id: credential.id,
    userId: credential.userId,
    provider: credential.provider,
    authMethod: credential.authMethod,
    tokenMasked: credential.tokenMasked,
    scopes: credential.scopes,
    site: credential.site,
    tenantId: credential.tenantId,
    accountId: credential.accountId,
    accountName: credential.accountName,
    createdAt: credential.createdAt,
    revokedAt: credential.revokedAt,
  };
}

function maskToken(value: string): string {
  const tail = value.slice(-4);
  return `****${tail}`;
}

function upsertByUserAndProvider(credential: MonitoringCredential): void {
  for (const [id, existing] of store.entries()) {
    if (
      existing.userId === credential.userId
      && existing.provider === credential.provider
      && !existing.revokedAt
    ) {
      store.delete(id);
    }
  }
  store.set(credential.id, credential);
}

export const monitoringCredentialStore = {
  saveOAuth(params: {
    userId: string;
    provider: MonitoringProvider;
    accessToken: string;
    refreshToken?: string;
    scopes: string[];
    tenantId?: string;
    accountId?: string;
    accountName?: string;
    metadata?: Record<string, string>;
  }): MonitoringCredentialPublic {
    const credential: MonitoringCredential = {
      id: uuidv4(),
      userId: params.userId,
      provider: params.provider,
      authMethod: "oauth2_pkce",
      tokenEncrypted: encrypt(params.accessToken),
      tokenMasked: maskToken(params.accessToken),
      refreshTokenEncrypted: params.refreshToken ? encrypt(params.refreshToken) : undefined,
      scopes: params.scopes,
      tenantId: params.tenantId,
      accountId: params.accountId,
      accountName: params.accountName,
      createdAt: new Date().toISOString(),
      metadata: params.metadata,
    };

    upsertByUserAndProvider(credential);
    return toPublic(credential);
  },

  saveApiKey(params: {
    userId: string;
    provider: MonitoringProvider;
    apiKey: string;
    scopes?: string[];
    site?: string;
    accountId?: string;
    accountName?: string;
    metadata?: Record<string, string>;
  }): MonitoringCredentialPublic {
    const credential: MonitoringCredential = {
      id: uuidv4(),
      userId: params.userId,
      provider: params.provider,
      authMethod: "api_key",
      tokenEncrypted: encrypt(params.apiKey),
      tokenMasked: maskToken(params.apiKey),
      scopes: params.scopes ?? [],
      site: params.site,
      accountId: params.accountId,
      accountName: params.accountName,
      createdAt: new Date().toISOString(),
      metadata: params.metadata,
    };

    upsertByUserAndProvider(credential);
    return toPublic(credential);
  },

  getPublicByUser(userId: string): MonitoringCredentialPublic[] {
    return Array.from(store.values())
      .filter((credential) => credential.userId === userId)
      .map(toPublic);
  },

  getActiveByUserAndProvider(userId: string, provider: MonitoringProvider): MonitoringCredential | null {
    const active = Array.from(store.values())
      .filter(
        (credential) => credential.userId === userId
          && credential.provider === provider
          && !credential.revokedAt
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return active[0] ?? null;
  },

  getLatestActiveByUser(userId: string): MonitoringCredential | null {
    const active = Array.from(store.values())
      .filter((credential) => credential.userId === userId && !credential.revokedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return active[0] ?? null;
  },

  decryptAccessToken(credential: MonitoringCredential): string {
    return decrypt(credential.tokenEncrypted);
  },

  decryptRefreshToken(credential: MonitoringCredential): string | null {
    if (!credential.refreshTokenEncrypted) return null;
    return decrypt(credential.refreshTokenEncrypted);
  },

  rotateToken(params: {
    credentialId: string;
    accessToken: string;
    refreshToken?: string;
    scopes?: string[];
    expiresAt?: string;
  }): MonitoringCredentialPublic | null {
    const existing = store.get(params.credentialId);
    if (!existing || existing.revokedAt) return null;

    const updated: MonitoringCredential = {
      ...existing,
      tokenEncrypted: encrypt(params.accessToken),
      tokenMasked: maskToken(params.accessToken),
      refreshTokenEncrypted: params.refreshToken
        ? encrypt(params.refreshToken)
        : existing.refreshTokenEncrypted,
      scopes: params.scopes ?? existing.scopes,
      metadata: {
        ...(existing.metadata ?? {}),
        ...(params.expiresAt ? { expiresAt: params.expiresAt } : {}),
      },
    };

    store.set(updated.id, updated);
    return toPublic(updated);
  },

  revoke(credentialId: string, userId: string): boolean {
    const existing = store.get(credentialId);
    if (!existing || existing.userId !== userId || existing.revokedAt) {
      return false;
    }

    store.set(credentialId, {
      ...existing,
      revokedAt: new Date().toISOString(),
    });
    return true;
  },

  clear(): void {
    store.clear();
  },
};
