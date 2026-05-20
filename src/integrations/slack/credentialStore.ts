/**
 * Slack credential store (HEL-180).
 *
 * Backed by the shared `CredentialRegistry` so credentials persist in the
 * `connector_credentials` table (migration 006, `service='slack'`) and
 * survive Fly restarts. Token encryption is delegated to the shared
 * `connectorSecretVault` which supports key versioning + rotation via
 * `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` (+ `_V2`, `_PREVIOUS`).
 *
 * Mirrors the HubSpot connector store pattern (`hubspot/credentialStore.ts`)
 * so the upcoming linear / intercom / docusign migrations all look the same.
 *
 * Synchronous variants keep the existing hot-path callers (e.g. local-bucket
 * lookups inside the same process) working. Async variants hydrate from
 * Postgres when the local bucket is empty (post-restart, multi-worker, etc.)
 * — service.ts call sites use the async variants so Slack OAuth grants
 * survive a Fly restart end-to-end.
 */

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

async function upsertByUserAndTeam(credential: SlackCredential): Promise<void> {
  // Soft-evict any prior active credential for the same (userId, teamId).
  // Mirrors the legacy in-memory behavior: a fresh OAuth grant should
  // replace, not duplicate, an existing active connection.
  //
  // HEL-180 / Codex P2 on #926: hydrate from Postgres BEFORE purging so
  // we catch credentials that exist only in the durable store after a
  // restart. `registry.purge()` itself deletes hydrated rows from
  // Postgres for any IDs it finds in the (now-populated) local bucket.
  await registry.listStoredByUserAsync(credential.userId);
  registry.purge(
    (existing) =>
      existing.userId === credential.userId &&
      existing.teamId === credential.teamId &&
      !existing.revokedAt,
  );
  registry.save(credential);
}

export const slackCredentialStore = {
  // HEL-180 / Codex P2 on #926: now async so the upsert can hydrate
  // existing credentials from Postgres before purging the prior active
  // record for the same (userId, teamId).
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

  // ----- Sync getters (local bucket only — fast path within same process) -----

  getPublicByUser(userId: string): SlackCredentialPublic[] {
    return registry.listPublicByUser(userId);
  },

  getById(id: string, userId: string): SlackCredential | null {
    const credential = registry.getById(id);
    if (!credential || credential.userId !== userId || credential.revokedAt) {
      return null;
    }
    return credential;
  },

  getActiveByUser(userId: string): SlackCredential | null {
    return registry.findLatest(
      (credential) => credential.userId === userId && !credential.revokedAt,
    );
  },

  // ----- Async getters (Postgres-hydrating — survives restart) -----

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
      (credential) => credential.userId === userId && !credential.revokedAt,
    );
  },

  // ----- Token decryption -----

  decryptAccessToken(credential: SlackCredential): string {
    return registry.decryptSecret(credential.tokenEncrypted);
  },

  decryptRefreshToken(credential: SlackCredential): string | null {
    if (!credential.refreshTokenEncrypted) return null;
    return registry.decryptSecret(credential.refreshTokenEncrypted);
  },

  // ----- Mutation -----

  rotateToken(params: {
    credentialId: string;
    accessToken: string;
    refreshToken?: string;
    scopes?: string[];
  }): SlackCredentialPublic | null {
    const updated = registry.update(params.credentialId, (existing) => {
      if (existing.revokedAt) return existing;
      return {
        ...existing,
        tokenEncrypted: registry.encryptSecret(params.accessToken),
        tokenMasked: maskSecret(params.accessToken),
        refreshTokenEncrypted: params.refreshToken
          ? registry.encryptSecret(params.refreshToken)
          : existing.refreshTokenEncrypted,
        scopes: params.scopes ?? existing.scopes,
      };
    });
    if (!updated || updated.revokedAt) return null;
    return toPublic(updated);
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

  // ----- Test helper -----

  clear(): void {
    registry.clear();
  },
};
