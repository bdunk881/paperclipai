import { v4 as uuidv4 } from "uuid";
import { CredentialRegistry, maskSecret } from "../shared/credentialRegistry";
import { ComposioCredential, ComposioCredentialPublic } from "./types";

function toPublic(credential: ComposioCredential): ComposioCredentialPublic {
  return {
    id: credential.id,
    userId: credential.userId,
    authMethod: credential.authMethod,
    tokenMasked: credential.tokenMasked,
    createdAt: credential.createdAt,
    revokedAt: credential.revokedAt,
  };
}

const registry = new CredentialRegistry<ComposioCredential, ComposioCredentialPublic>({
  service: "composio",
  toPublic,
});

export const composioCredentialStore = {
  saveApiKey(params: {
    userId: string;
    apiKey: string;
    metadata?: Record<string, string>;
  }): ComposioCredentialPublic {
    registry.purge((credential) => credential.userId === params.userId && !credential.revokedAt);

    const credential: ComposioCredential = {
      id: uuidv4(),
      userId: params.userId,
      authMethod: "api_key",
      tokenEncrypted: registry.encryptSecret(params.apiKey),
      tokenMasked: maskSecret(params.apiKey),
      createdAt: new Date().toISOString(),
      metadata: params.metadata,
    };

    registry.save(credential);
    return toPublic(credential);
  },

  getPublicByUser(userId: string): ComposioCredentialPublic[] {
    return registry.listPublicByUser(userId);
  },

  async getPublicByUserAsync(userId: string): Promise<ComposioCredentialPublic[]> {
    return registry.listPublicByUserAsync(userId);
  },

  getActiveByUser(userId: string): ComposioCredential | null {
    return registry.findLatest((credential) => credential.userId === userId && !credential.revokedAt);
  },

  async getActiveByUserAsync(userId: string): Promise<ComposioCredential | null> {
    return registry.findLatestAsync((credential) => credential.userId === userId && !credential.revokedAt);
  },

  decryptAccessToken(credential: ComposioCredential): string {
    return registry.decryptSecret(credential.tokenEncrypted);
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
    const existing = await registry.getByIdAsync(credentialId);
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
