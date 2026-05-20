import { randomUUID } from "node:crypto";
import { CredentialRegistry, maskSecret } from "../shared/credentialRegistry";
import { SlackCredential, SlackCredentialPublic } from "./types";

function toPublic(credential: SlackCredential): SlackCredentialPublic {
  return {
    id: credential.id,
    userId: credential.userId,
    authMethod: credential.authMethod,
    tokenMasked: credential.tokenMasked,
    scopes: credential.scopes,
    teamId: credential.teamId,
    teamName: credential.teamName,
    createdAt: credential.createdAt,
    revokedAt: credential.revokedAt,
  };
}

const registry = new CredentialRegistry<SlackCredential, SlackCredentialPublic>({
  service: "slack",
  toPublic,
});

// Load active records for the user from Postgres into the in-memory bucket
// before purging, so purge() can find and delete stale rows that were written
// in a previous process (the bucket is empty after a restart).
async function upsertByUserAndTeam(credential: SlackCredential): Promise<void> {
  await registry.listStoredByUserAsync(credential.userId, false);
  registry.purge(
    (existing) =>
      existing.userId === credential.userId &&
      existing.teamId === credential.teamId &&
      !existing.revokedAt
  );
  registry.save(credential);
}

export const slackCredentialStore = {
  async saveOAuth(params: {
    userId: string;
    accessToken: string;
    refreshToken?: string;
    scopes: string[];
    teamId: string;
    teamName?: string;
    metadata?: Record<string, string>;
  }): Promise<SlackCredentialPublic> {
    const credential: SlackCredential = {
      id: randomUUID(),
      userId: params.userId,
      authMethod: "oauth2_pkce",
      tokenEncrypted: registry.encryptSecret(params.accessToken),
      tokenMasked: maskSecret(params.accessToken),
      refreshTokenEncrypted: params.refreshToken
        ? registry.encryptSecret(params.refreshToken)
        : undefined,
      scopes: params.scopes,
      teamId: params.teamId,
      teamName: params.teamName,
      createdAt: new Date().toISOString(),
      metadata: params.metadata,
    };

    await upsertByUserAndTeam(credential);
    return toPublic(credential);
  },

  async saveApiKey(params: {
    userId: string;
    botToken: string;
    scopes?: string[];
    teamId: string;
    teamName?: string;
    metadata?: Record<string, string>;
  }): Promise<SlackCredentialPublic> {
    const credential: SlackCredential = {
      id: randomUUID(),
      userId: params.userId,
      authMethod: "api_key",
      tokenEncrypted: registry.encryptSecret(params.botToken),
      tokenMasked: maskSecret(params.botToken),
      scopes: params.scopes ?? [],
      teamId: params.teamId,
      teamName: params.teamName,
      createdAt: new Date().toISOString(),
      metadata: params.metadata,
    };

    await upsertByUserAndTeam(credential);
    return toPublic(credential);
  },

  async getPublicByUserAsync(userId: string): Promise<SlackCredentialPublic[]> {
    return registry.listPublicByUserAsync(userId);
  },

  async getByIdAsync(id: string, userId: string): Promise<SlackCredential | null> {
    const credential = await registry.getByIdAsync(id);
    if (!credential || credential.userId !== userId || credential.revokedAt) {
      return null;
    }
    return credential;
  },

  async getActiveByUserAsync(userId: string): Promise<SlackCredential | null> {
    return registry.findLatestAsync(
      (credential) => credential.userId === userId && !credential.revokedAt
    );
  },

  decryptAccessToken(credential: SlackCredential): string {
    return registry.decryptSecret(credential.tokenEncrypted);
  },

  decryptRefreshToken(credential: SlackCredential): string | null {
    if (!credential.refreshTokenEncrypted) return null;
    return registry.decryptSecret(credential.refreshTokenEncrypted);
  },

  rotateToken(params: {
    credentialId: string;
    accessToken: string;
    refreshToken?: string;
    scopes?: string[];
  }): SlackCredentialPublic | null {
    const updated = registry.update(params.credentialId, (existing) => ({
      ...existing,
      tokenEncrypted: registry.encryptSecret(params.accessToken),
      tokenMasked: maskSecret(params.accessToken),
      refreshTokenEncrypted: params.refreshToken
        ? registry.encryptSecret(params.refreshToken)
        : existing.refreshTokenEncrypted,
      scopes: params.scopes ?? existing.scopes,
    }));

    return updated ? toPublic(updated) : null;
  },

  async revoke(credentialId: string, userId: string): Promise<boolean> {
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
