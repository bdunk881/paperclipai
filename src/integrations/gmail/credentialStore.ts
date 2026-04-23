import { randomUUID } from "node:crypto";
import { CredentialRegistry, maskSecret } from "../shared/credentialRegistry";
import { GmailCredential, GmailCredentialPublic } from "./types";

function toPublic(credential: GmailCredential): GmailCredentialPublic {
  return {
    id: credential.id,
    userId: credential.userId,
    authMethod: credential.authMethod,
    tokenMasked: credential.tokenMasked,
    scopes: credential.scopes,
    emailAddress: credential.emailAddress,
    createdAt: credential.createdAt,
    revokedAt: credential.revokedAt,
  };
}

const registry = new CredentialRegistry<GmailCredential, GmailCredentialPublic>({
  service: "gmail",
  toPublic,
});

function upsertByUserAndEmail(credential: GmailCredential): void {
  registry.purge((existing) =>
    existing.userId === credential.userId &&
    existing.emailAddress === credential.emailAddress &&
    !existing.revokedAt
  );
  registry.save(credential);
}

export const gmailCredentialStore = {
  saveOAuth(params: {
    userId: string;
    accessToken: string;
    refreshToken?: string;
    scopes: string[];
    emailAddress: string;
    metadata?: Record<string, string>;
  }): GmailCredentialPublic {
    const credential: GmailCredential = {
      id: randomUUID(),
      userId: params.userId,
      authMethod: "oauth2_pkce",
      tokenEncrypted: registry.encryptSecret(params.accessToken),
      tokenMasked: maskSecret(params.accessToken),
      refreshTokenEncrypted: params.refreshToken
        ? registry.encryptSecret(params.refreshToken)
        : undefined,
      scopes: params.scopes,
      emailAddress: params.emailAddress,
      createdAt: new Date().toISOString(),
      metadata: params.metadata,
    };

    upsertByUserAndEmail(credential);
    return toPublic(credential);
  },

  saveApiKey(params: {
    userId: string;
    apiKey: string;
    scopes?: string[];
    emailAddress: string;
    metadata?: Record<string, string>;
  }): GmailCredentialPublic {
    const credential: GmailCredential = {
      id: randomUUID(),
      userId: params.userId,
      authMethod: "api_key",
      tokenEncrypted: registry.encryptSecret(params.apiKey),
      tokenMasked: maskSecret(params.apiKey),
      scopes: params.scopes ?? [],
      emailAddress: params.emailAddress,
      createdAt: new Date().toISOString(),
      metadata: params.metadata,
    };

    upsertByUserAndEmail(credential);
    return toPublic(credential);
  },

  getPublicByUser(userId: string): GmailCredentialPublic[] {
    return registry.listPublicByUser(userId);
  },

  async getPublicByUserAsync(userId: string): Promise<GmailCredentialPublic[]> {
    return registry.listPublicByUser(userId);
  },

  getActiveByUser(userId: string): GmailCredential | null {
    return registry.findLatest((record) => record.userId === userId && !record.revokedAt);
  },

  async getActiveByUserAsync(userId: string): Promise<GmailCredential | null> {
    return registry.findLatest((record) => record.userId === userId && !record.revokedAt);
  },

  decryptAccessToken(credential: GmailCredential): string {
    return registry.decryptSecret(credential.tokenEncrypted);
  },

  decryptRefreshToken(credential: GmailCredential): string | null {
    return credential.refreshTokenEncrypted
      ? registry.decryptSecret(credential.refreshTokenEncrypted)
      : null;
  },

  rotateToken(params: {
    credentialId: string;
    accessToken: string;
    refreshToken?: string;
    scopes?: string[];
    emailAddress?: string;
    expiresAt?: string;
    historyId?: string;
  }): GmailCredentialPublic | null {
    const updated = registry.update(params.credentialId, (existing) => ({
      ...existing,
      tokenEncrypted: registry.encryptSecret(params.accessToken),
      tokenMasked: maskSecret(params.accessToken),
      refreshTokenEncrypted: params.refreshToken
        ? registry.encryptSecret(params.refreshToken)
        : existing.refreshTokenEncrypted,
      scopes: params.scopes ?? existing.scopes,
      emailAddress: params.emailAddress ?? existing.emailAddress,
      metadata: {
        ...(existing.metadata ?? {}),
        ...(params.expiresAt ? { expiresAt: params.expiresAt } : {}),
        ...(params.historyId ? { historyId: params.historyId } : {}),
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
