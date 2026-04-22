import { v4 as uuidv4 } from "uuid";
import { CredentialRegistry, maskSecret } from "../shared/credentialRegistry";
import { HubSpotCredential, HubSpotCredentialPublic } from "./types";

function toPublic(credential: HubSpotCredential): HubSpotCredentialPublic {
  return {
    id: credential.id,
    userId: credential.userId,
    authMethod: credential.authMethod,
    tokenMasked: credential.tokenMasked,
    scopes: credential.scopes,
    hubId: credential.hubId,
    hubDomain: credential.hubDomain,
    createdAt: credential.createdAt,
    revokedAt: credential.revokedAt,
  };
}

const registry = new CredentialRegistry<HubSpotCredential, HubSpotCredentialPublic>({
  service: "hubspot",
  toPublic,
});

function upsertByUserAndHub(credential: HubSpotCredential): void {
  registry.purge((existing) =>
    existing.userId === credential.userId &&
    existing.hubId === credential.hubId &&
    !existing.revokedAt
  );
  registry.save(credential);
}

export const hubSpotCredentialStore = {
  saveOAuth(params: {
    userId: string;
    accessToken: string;
    refreshToken?: string;
    scopes: string[];
    hubId: string;
    hubDomain?: string;
    metadata?: Record<string, string>;
  }): HubSpotCredentialPublic {
    const credential: HubSpotCredential = {
      id: uuidv4(),
      userId: params.userId,
      authMethod: "oauth2",
      tokenEncrypted: registry.encryptSecret(params.accessToken),
      tokenMasked: maskSecret(params.accessToken),
      refreshTokenEncrypted: params.refreshToken ? registry.encryptSecret(params.refreshToken) : undefined,
      scopes: params.scopes,
      hubId: params.hubId,
      hubDomain: params.hubDomain,
      createdAt: new Date().toISOString(),
      metadata: params.metadata,
    };

    upsertByUserAndHub(credential);
    return toPublic(credential);
  },

  saveApiKey(params: {
    userId: string;
    apiKey: string;
    scopes?: string[];
    hubId: string;
    hubDomain?: string;
    metadata?: Record<string, string>;
  }): HubSpotCredentialPublic {
    const credential: HubSpotCredential = {
      id: uuidv4(),
      userId: params.userId,
      authMethod: "api_key",
      tokenEncrypted: registry.encryptSecret(params.apiKey),
      tokenMasked: maskSecret(params.apiKey),
      scopes: params.scopes ?? [],
      hubId: params.hubId,
      hubDomain: params.hubDomain,
      createdAt: new Date().toISOString(),
      metadata: params.metadata,
    };

    upsertByUserAndHub(credential);
    return toPublic(credential);
  },

  getPublicByUser(userId: string): HubSpotCredentialPublic[] {
    return registry.listPublicByUser(userId);
  },

  async getPublicByUserAsync(userId: string): Promise<HubSpotCredentialPublic[]> {
    return registry.listPublicByUser(userId);
  },

  getActiveByUser(userId: string): HubSpotCredential | null {
    return registry.findLatest((credential) => credential.userId === userId && !credential.revokedAt);
  },

  async getActiveByUserAsync(userId: string): Promise<HubSpotCredential | null> {
    return registry.findLatest((credential) => credential.userId === userId && !credential.revokedAt);
  },

  decryptAccessToken(credential: HubSpotCredential): string {
    return registry.decryptSecret(credential.tokenEncrypted);
  },

  decryptRefreshToken(credential: HubSpotCredential): string | null {
    if (!credential.refreshTokenEncrypted) {
      return null;
    }
    return registry.decryptSecret(credential.refreshTokenEncrypted);
  },

  rotateToken(params: {
    credentialId: string;
    accessToken: string;
    refreshToken?: string;
    scopes?: string[];
    hubId?: string;
    hubDomain?: string;
    expiresAt?: string;
  }): HubSpotCredentialPublic | null {
    const updated = registry.update(params.credentialId, (existing) => ({
      ...existing,
      tokenEncrypted: registry.encryptSecret(params.accessToken),
      tokenMasked: maskSecret(params.accessToken),
      refreshTokenEncrypted: params.refreshToken
        ? registry.encryptSecret(params.refreshToken)
        : existing.refreshTokenEncrypted,
      scopes: params.scopes ?? existing.scopes,
      hubId: params.hubId ?? existing.hubId,
      hubDomain: params.hubDomain ?? existing.hubDomain,
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
