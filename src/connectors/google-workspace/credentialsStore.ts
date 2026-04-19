import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { v4 as uuidv4 } from "uuid";

export type GoogleWorkspaceAuthMethod = "oauth_pkce" | "api_key";
export type GoogleWorkspaceCredentialStatus = "pending_validation" | "active" | "revoked";

export interface GoogleWorkspaceCredential {
  id: string;
  userId: string;
  label: string;
  authMethod: GoogleWorkspaceAuthMethod;
  status: GoogleWorkspaceCredentialStatus;
  createdAt: string;
  updatedAt: string;
  lastValidatedAt: string | null;
  tokenRefreshFailures: number;
  clientId?: string;
  redirectUri?: string;
  scopesRequested?: string[];
  scopesGranted?: string[];
  oauthClientSecretEncrypted?: string;
  accessTokenEncrypted?: string;
  refreshTokenEncrypted?: string;
  accessTokenExpiresAt?: string | null;
  apiKeyEncrypted?: string;
  apiKeyMasked?: string;
  webhookSigningSecretEncrypted?: string;
}

export interface GoogleWorkspaceCredentialDecrypted extends GoogleWorkspaceCredential {
  oauthClientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  webhookSigningSecret?: string;
}

export type GoogleWorkspaceCredentialPublic = Omit<
  GoogleWorkspaceCredential,
  | "oauthClientSecretEncrypted"
  | "accessTokenEncrypted"
  | "refreshTokenEncrypted"
  | "apiKeyEncrypted"
  | "webhookSigningSecretEncrypted"
>;

const ENCRYPTION_KEY: Buffer = (() => {
  const envKey = process.env.CONNECTOR_CREDENTIALS_ENCRYPTION_KEY ?? process.env.LLM_CONFIG_ENCRYPTION_KEY;
  if (envKey) return scryptSync(envKey, "autoflow-connectors-salt", 32) as Buffer;
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
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid ciphertext format");
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data).toString("utf8") + decipher.final("utf8");
}

const store = new Map<string, GoogleWorkspaceCredential>();

function toPublic(credential: GoogleWorkspaceCredential): GoogleWorkspaceCredentialPublic {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const {
    oauthClientSecretEncrypted: _oauthSecret,
    accessTokenEncrypted: _accessToken,
    refreshTokenEncrypted: _refreshToken,
    apiKeyEncrypted: _apiKey,
    webhookSigningSecretEncrypted: _webhookSecret,
    ...safe
  } = credential;
  return safe;
}

function toDecrypted(credential: GoogleWorkspaceCredential): GoogleWorkspaceCredentialDecrypted {
  return {
    ...credential,
    oauthClientSecret: credential.oauthClientSecretEncrypted
      ? decrypt(credential.oauthClientSecretEncrypted)
      : undefined,
    accessToken: credential.accessTokenEncrypted ? decrypt(credential.accessTokenEncrypted) : undefined,
    refreshToken: credential.refreshTokenEncrypted ? decrypt(credential.refreshTokenEncrypted) : undefined,
    apiKey: credential.apiKeyEncrypted ? decrypt(credential.apiKeyEncrypted) : undefined,
    webhookSigningSecret: credential.webhookSigningSecretEncrypted
      ? decrypt(credential.webhookSigningSecretEncrypted)
      : undefined,
  };
}

export const googleWorkspaceCredentialsStore = {
  createOAuth(params: {
    userId: string;
    label: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopesRequested: string[];
    webhookSigningSecret?: string;
  }): GoogleWorkspaceCredentialPublic {
    const now = new Date().toISOString();
    const entry: GoogleWorkspaceCredential = {
      id: uuidv4(),
      userId: params.userId,
      label: params.label,
      authMethod: "oauth_pkce",
      status: "pending_validation",
      createdAt: now,
      updatedAt: now,
      lastValidatedAt: null,
      tokenRefreshFailures: 0,
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      scopesRequested: params.scopesRequested,
      oauthClientSecretEncrypted: encrypt(params.clientSecret),
      webhookSigningSecretEncrypted: params.webhookSigningSecret
        ? encrypt(params.webhookSigningSecret)
        : undefined,
    };

    store.set(entry.id, entry);
    return toPublic(entry);
  },

  createApiKey(params: {
    userId: string;
    label: string;
    apiKey: string;
    webhookSigningSecret?: string;
  }): GoogleWorkspaceCredentialPublic {
    const now = new Date().toISOString();
    const entry: GoogleWorkspaceCredential = {
      id: uuidv4(),
      userId: params.userId,
      label: params.label,
      authMethod: "api_key",
      status: "pending_validation",
      createdAt: now,
      updatedAt: now,
      lastValidatedAt: null,
      tokenRefreshFailures: 0,
      apiKeyEncrypted: encrypt(params.apiKey),
      apiKeyMasked: `****${params.apiKey.slice(-4)}`,
      webhookSigningSecretEncrypted: params.webhookSigningSecret
        ? encrypt(params.webhookSigningSecret)
        : undefined,
    };

    store.set(entry.id, entry);
    return toPublic(entry);
  },

  list(userId: string): GoogleWorkspaceCredentialPublic[] {
    return Array.from(store.values())
      .filter((entry) => entry.userId === userId)
      .map(toPublic);
  },

  get(id: string, userId: string): GoogleWorkspaceCredentialPublic | undefined {
    const entry = store.get(id);
    if (!entry || entry.userId !== userId) return undefined;
    return toPublic(entry);
  },

  getAnyById(id: string): GoogleWorkspaceCredentialDecrypted | undefined {
    const entry = store.get(id);
    if (!entry || entry.status === "revoked") return undefined;
    return toDecrypted(entry);
  },

  getDecrypted(id: string, userId: string): GoogleWorkspaceCredentialDecrypted | undefined {
    const entry = store.get(id);
    if (!entry || entry.userId !== userId || entry.status === "revoked") return undefined;
    return toDecrypted(entry);
  },

  markValidated(id: string, userId: string): GoogleWorkspaceCredentialPublic | undefined {
    const entry = store.get(id);
    if (!entry || entry.userId !== userId || entry.status === "revoked") return undefined;

    const updated: GoogleWorkspaceCredential = {
      ...entry,
      status: "active",
      updatedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
    };
    store.set(id, updated);
    return toPublic(updated);
  },

  storeOAuthTokens(params: {
    id: string;
    userId: string;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string | null;
    scopesGranted?: string[];
  }): GoogleWorkspaceCredentialPublic | undefined {
    const entry = store.get(params.id);
    if (!entry || entry.userId !== params.userId || entry.status === "revoked") return undefined;

    const updated: GoogleWorkspaceCredential = {
      ...entry,
      status: "active",
      updatedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      tokenRefreshFailures: 0,
      accessTokenEncrypted: encrypt(params.accessToken),
      refreshTokenEncrypted: params.refreshToken ? encrypt(params.refreshToken) : entry.refreshTokenEncrypted,
      accessTokenExpiresAt: params.expiresAt ?? null,
      scopesGranted: params.scopesGranted ?? entry.scopesGranted ?? entry.scopesRequested,
    };
    store.set(params.id, updated);
    return toPublic(updated);
  },

  recordTokenRefreshFailure(id: string, userId: string): GoogleWorkspaceCredentialPublic | undefined {
    const entry = store.get(id);
    if (!entry || entry.userId !== userId || entry.status === "revoked") return undefined;

    const updated: GoogleWorkspaceCredential = {
      ...entry,
      updatedAt: new Date().toISOString(),
      tokenRefreshFailures: entry.tokenRefreshFailures + 1,
    };
    store.set(id, updated);
    return toPublic(updated);
  },

  revoke(id: string, userId: string): GoogleWorkspaceCredentialPublic | undefined {
    const entry = store.get(id);
    if (!entry || entry.userId !== userId) return undefined;

    const updated: GoogleWorkspaceCredential = {
      ...entry,
      status: "revoked",
      updatedAt: new Date().toISOString(),
    };
    store.set(id, updated);
    return toPublic(updated);
  },

  health(userId: string): {
    status: "ok" | "degraded";
    connector: "google_workspace";
    total: number;
    active: number;
    pendingValidation: number;
    revoked: number;
    tokenRefreshFailures: number;
  } {
    const entries = Array.from(store.values()).filter((entry) => entry.userId === userId);
    const active = entries.filter((entry) => entry.status === "active").length;
    const pendingValidation = entries.filter((entry) => entry.status === "pending_validation").length;
    const revoked = entries.filter((entry) => entry.status === "revoked").length;
    const tokenRefreshFailures = entries.reduce((acc, entry) => acc + entry.tokenRefreshFailures, 0);

    return {
      status: pendingValidation > 0 || revoked > 0 || tokenRefreshFailures > 0 ? "degraded" : "ok",
      connector: "google_workspace",
      total: entries.length,
      active,
      pendingValidation,
      revoked,
      tokenRefreshFailures,
    };
  },

  clear(): void {
    store.clear();
  },
};
