import { randomUUID } from "node:crypto";
import { CredentialRegistry } from "../shared/credentialRegistry";
import { ApolloCredential, ApolloCredentialPublic } from "./types";

function toPublic(credential: ApolloCredential): ApolloCredentialPublic {
  return {
    id: credential.id,
    userId: credential.userId,
    authMethod: credential.authMethod,
    tokenMasked: credential.tokenMasked,
    scopes: credential.scopes,
    accountId: credential.accountId,
    accountLabel: credential.accountLabel,
    createdAt: credential.createdAt,
    revokedAt: credential.revokedAt,
  };
}

const registry = new CredentialRegistry<ApolloCredential, ApolloCredentialPublic>({
  service: "apollo",
  toPublic,
});

function maskToken(value: string): string {
  return `****${value.slice(-4)}`;
}

async function upsertByUserAndAccount(credential: ApolloCredential): Promise<void> {
  // HEL-182: hydrate from Postgres BEFORE looking for the existing record —
  // findLatest only inspects the local in-process bucket, so after a Fly
  // restart it returns null and we end up with duplicate active rows.
  // Same pattern as slack/credentialStore.ts (post-#926).
  await registry.listStoredByUserAsync(credential.userId);
  const existing = registry.findLatest(
    (record) =>
      record.userId === credential.userId &&
      record.accountId === credential.accountId &&
      !record.revokedAt
  );

  if (existing) {
    registry.purge((record) => record.id === existing.id);
  }

  registry.save(credential);
}

export const apolloCredentialStore = {
  async saveOAuth(params: {
    userId: string;
    accessToken: string;
    refreshToken?: string;
    scopes: string[];
    accountId: string;
    accountLabel?: string;
    metadata?: Record<string, string>;
  }): Promise<ApolloCredentialPublic> {
    const credential: ApolloCredential = {
      id: randomUUID(),
      userId: params.userId,
      authMethod: "oauth2",
      tokenEncrypted: registry.encryptSecret(params.accessToken),
      tokenMasked: maskToken(params.accessToken),
      refreshTokenEncrypted: params.refreshToken
        ? registry.encryptSecret(params.refreshToken)
        : undefined,
      scopes: params.scopes,
      accountId: params.accountId,
      accountLabel: params.accountLabel,
      createdAt: new Date().toISOString(),
      metadata: params.metadata,
    };

    await upsertByUserAndAccount(credential);
    return toPublic(credential);
  },

  async saveApiKey(params: {
    userId: string;
    apiKey: string;
    scopes?: string[];
    accountId: string;
    accountLabel?: string;
    metadata?: Record<string, string>;
  }): Promise<ApolloCredentialPublic> {
    const credential: ApolloCredential = {
      id: randomUUID(),
      userId: params.userId,
      authMethod: "api_key",
      tokenEncrypted: registry.encryptSecret(params.apiKey),
      tokenMasked: maskToken(params.apiKey),
      scopes: params.scopes ?? [],
      accountId: params.accountId,
      accountLabel: params.accountLabel,
      createdAt: new Date().toISOString(),
      metadata: params.metadata,
    };

    await upsertByUserAndAccount(credential);
    return toPublic(credential);
  },

  getPublicByUser(userId: string): ApolloCredentialPublic[] {
    return registry.listPublicByUser(userId);
  },

  async getPublicByUserAsync(userId: string): Promise<ApolloCredentialPublic[]> {
    return registry.listPublicByUser(userId);
  },

  getActiveByUser(userId: string): ApolloCredential | null {
    return registry.findLatest((record) => record.userId === userId && !record.revokedAt);
  },

  async getActiveByUserAsync(userId: string): Promise<ApolloCredential | null> {
    return registry.findLatest((record) => record.userId === userId && !record.revokedAt);
  },

  decryptAccessToken(credential: ApolloCredential): string {
    return registry.decryptSecret(credential.tokenEncrypted);
  },

  decryptRefreshToken(credential: ApolloCredential): string | null {
    return credential.refreshTokenEncrypted
      ? registry.decryptSecret(credential.refreshTokenEncrypted)
      : null;
  },

  rotateToken(params: {
    credentialId: string;
    accessToken: string;
    refreshToken?: string;
    scopes?: string[];
    expiresAt?: string;
  }): ApolloCredentialPublic | null {
    const updated = registry.update(params.credentialId, (existing) => ({
      ...existing,
      tokenEncrypted: registry.encryptSecret(params.accessToken),
      tokenMasked: maskToken(params.accessToken),
      refreshTokenEncrypted: params.refreshToken
        ? registry.encryptSecret(params.refreshToken)
        : existing.refreshTokenEncrypted,
      scopes: params.scopes ?? existing.scopes,
      metadata: {
        ...(existing.metadata ?? {}),
        ...(params.expiresAt ? { expiresAt: params.expiresAt } : {}),
      },
    }));

    return updated ? toPublic(updated) : null;
  },

  revoke(credentialId: string, userId: string): boolean {
    const existing = registry.getById(credentialId);
    if (!existing || existing.userId !== userId || existing.revokedAt) {
      return false;
    }

    registry.update(credentialId, (record) => ({
      ...record,
      revokedAt: new Date().toISOString(),
    }));

    return true;
  },

  async revokeAsync(credentialId: string, userId: string): Promise<boolean> {
    const existing = await registry.getById(credentialId);
    if (!existing || existing.userId !== userId || existing.revokedAt) {
      return false;
    }

    registry.update(credentialId, (record) => ({
      ...record,
      revokedAt: new Date().toISOString(),
    }));

    return true;
  },

  clear(): void {
    registry.clear();
  },
};
