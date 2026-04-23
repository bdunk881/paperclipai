import { randomUUID } from "node:crypto";
import { SentryCredential, SentryCredentialPublic } from "./types";
import { CredentialRegistry, maskSecret } from "../shared/credentialRegistry";

const registry = new CredentialRegistry<SentryCredential, SentryCredentialPublic>({
  service: "sentry",
  toPublic: (credential) => ({
    id: credential.id,
    userId: credential.userId,
    authMethod: credential.authMethod,
    tokenMasked: credential.tokenMasked,
    scopes: credential.scopes,
    organizationId: credential.organizationId,
    organizationSlug: credential.organizationSlug,
    organizationName: credential.organizationName,
    createdAt: credential.createdAt,
    revokedAt: credential.revokedAt,
  }),
});

function upsertByUserAndOrganization(credential: SentryCredential): void {
  registry.purge((existing) =>
    existing.userId === credential.userId &&
    existing.organizationSlug === credential.organizationSlug &&
    !existing.revokedAt
  );
  registry.save(credential);
}

export const sentryCredentialStore = {
  saveOAuth(params: {
    userId: string;
    accessToken: string;
    refreshToken?: string;
    scopes: string[];
    organizationId: string;
    organizationSlug: string;
    organizationName?: string;
    metadata?: Record<string, string>;
  }): SentryCredentialPublic {
    const credential: SentryCredential = {
      id: randomUUID(),
      userId: params.userId,
      authMethod: "oauth2_pkce",
      tokenEncrypted: registry.encryptSecret(params.accessToken),
      tokenMasked: maskSecret(params.accessToken),
      refreshTokenEncrypted: params.refreshToken
        ? registry.encryptSecret(params.refreshToken)
        : undefined,
      scopes: params.scopes,
      organizationId: params.organizationId,
      organizationSlug: params.organizationSlug,
      organizationName: params.organizationName,
      createdAt: new Date().toISOString(),
      metadata: params.metadata,
    };

    upsertByUserAndOrganization(credential);
    return registry.toPublic(credential);
  },

  saveApiKey(params: {
    userId: string;
    apiKey: string;
    scopes?: string[];
    organizationId: string;
    organizationSlug: string;
    organizationName?: string;
    metadata?: Record<string, string>;
  }): SentryCredentialPublic {
    const credential: SentryCredential = {
      id: randomUUID(),
      userId: params.userId,
      authMethod: "api_key",
      tokenEncrypted: registry.encryptSecret(params.apiKey),
      tokenMasked: maskSecret(params.apiKey),
      scopes: params.scopes ?? [],
      organizationId: params.organizationId,
      organizationSlug: params.organizationSlug,
      organizationName: params.organizationName,
      createdAt: new Date().toISOString(),
      metadata: params.metadata,
    };

    upsertByUserAndOrganization(credential);
    return registry.toPublic(credential);
  },

  getPublicByUser(userId: string): SentryCredentialPublic[] {
    return registry.listPublicByUser(userId);
  },

  async getPublicByUserAsync(userId: string): Promise<SentryCredentialPublic[]> {
    return registry.listPublicByUser(userId);
  },

  getActiveByUser(userId: string): SentryCredential | null {
    return registry.findLatest((credential) => credential.userId === userId);
  },

  async getActiveByUserAsync(userId: string): Promise<SentryCredential | null> {
    return registry.findLatest((credential) => credential.userId === userId);
  },

  decryptAccessToken(credential: SentryCredential): string {
    return registry.decryptSecret(credential.tokenEncrypted);
  },

  decryptRefreshToken(credential: SentryCredential): string | null {
    if (!credential.refreshTokenEncrypted) return null;
    return registry.decryptSecret(credential.refreshTokenEncrypted);
  },

  rotateToken(params: {
    credentialId: string;
    accessToken: string;
    refreshToken?: string;
    scopes?: string[];
    expiresAt?: string;
  }): SentryCredentialPublic | null {
    const updated = registry.update(params.credentialId, (existing) => ({
      ...existing,
      tokenEncrypted: registry.encryptSecret(params.accessToken),
      tokenMasked: maskSecret(params.accessToken),
      refreshTokenEncrypted: params.refreshToken
        ? registry.encryptSecret(params.refreshToken)
        : existing.refreshTokenEncrypted,
      scopes: params.scopes ?? existing.scopes,
      metadata: {
        ...(existing.metadata ?? {}),
        ...(params.expiresAt ? { expiresAt: params.expiresAt } : {}),
      },
    }));

    return updated ? registry.toPublic(updated) : null;
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
