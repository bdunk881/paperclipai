import { randomUUID } from "node:crypto";
import { CredentialRegistry } from "../shared/credentialRegistry";
import { StripeCredential, StripeCredentialPublic } from "./types";

function toPublic(credential: StripeCredential): StripeCredentialPublic {
  return {
    id: credential.id,
    userId: credential.userId,
    authMethod: credential.authMethod,
    tokenMasked: credential.tokenMasked,
    scopes: credential.scopes,
    accountId: credential.accountId,
    accountName: credential.accountName,
    accountEmail: credential.accountEmail,
    livemode: credential.livemode,
    createdAt: credential.createdAt,
    revokedAt: credential.revokedAt,
  };
}

const registry = new CredentialRegistry<StripeCredential, StripeCredentialPublic>({
  service: "stripe",
  toPublic,
});

function maskToken(value: string): string {
  return `****${value.slice(-4)}`;
}

function upsertByUserAndAccount(credential: StripeCredential): void {
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

export const stripeCredentialStore = {
  saveOAuth(params: {
    userId: string;
    accessToken: string;
    refreshToken?: string;
    scopes: string[];
    accountId: string;
    accountName?: string;
    accountEmail?: string;
    livemode: boolean;
    metadata?: Record<string, string>;
  }): StripeCredentialPublic {
    const credential: StripeCredential = {
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
      accountName: params.accountName,
      accountEmail: params.accountEmail,
      livemode: params.livemode,
      createdAt: new Date().toISOString(),
      metadata: params.metadata,
    };

    upsertByUserAndAccount(credential);
    return toPublic(credential);
  },

  saveApiKey(params: {
    userId: string;
    apiKey: string;
    scopes?: string[];
    accountId: string;
    accountName?: string;
    accountEmail?: string;
    livemode: boolean;
    metadata?: Record<string, string>;
  }): StripeCredentialPublic {
    const credential: StripeCredential = {
      id: randomUUID(),
      userId: params.userId,
      authMethod: "api_key",
      tokenEncrypted: registry.encryptSecret(params.apiKey),
      tokenMasked: maskToken(params.apiKey),
      scopes: params.scopes ?? [],
      accountId: params.accountId,
      accountName: params.accountName,
      accountEmail: params.accountEmail,
      livemode: params.livemode,
      createdAt: new Date().toISOString(),
      metadata: params.metadata,
    };

    upsertByUserAndAccount(credential);
    return toPublic(credential);
  },

  getPublicByUser(userId: string): StripeCredentialPublic[] {
    return registry.listPublicByUser(userId);
  },

  async getPublicByUserAsync(userId: string): Promise<StripeCredentialPublic[]> {
    return registry.listPublicByUser(userId);
  },

  getActiveByUser(userId: string): StripeCredential | null {
    return registry.findLatest((record) => record.userId === userId && !record.revokedAt);
  },

  async getActiveByUserAsync(userId: string): Promise<StripeCredential | null> {
    return registry.findLatest((record) => record.userId === userId && !record.revokedAt);
  },

  decryptAccessToken(credential: StripeCredential): string {
    return registry.decryptSecret(credential.tokenEncrypted);
  },

  decryptRefreshToken(credential: StripeCredential): string | null {
    return credential.refreshTokenEncrypted
      ? registry.decryptSecret(credential.refreshTokenEncrypted)
      : null;
  },

  rotateToken(params: {
    credentialId: string;
    accessToken: string;
    refreshToken?: string;
    scopes?: string[];
    accountName?: string;
    accountEmail?: string;
    livemode?: boolean;
  }): StripeCredentialPublic | null {
    const updated = registry.update(params.credentialId, (existing) => ({
      ...existing,
      tokenEncrypted: registry.encryptSecret(params.accessToken),
      tokenMasked: maskToken(params.accessToken),
      refreshTokenEncrypted: params.refreshToken
        ? registry.encryptSecret(params.refreshToken)
        : existing.refreshTokenEncrypted,
      scopes: params.scopes ?? existing.scopes,
      accountName: params.accountName ?? existing.accountName,
      accountEmail: params.accountEmail ?? existing.accountEmail,
      livemode: params.livemode ?? existing.livemode,
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
