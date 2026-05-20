import { randomUUID } from "node:crypto";
import { SlackCredential, SlackCredentialPublic } from "./types";
// HEL-180: shared AES-256-GCM cipher across every connector credentialStore.
// The pre-shared cipher was 30 lines of copy-paste in each connector's
// credentialStore.ts with a `randomBytes(32)` fallback that silently
// invalidated saved credentials on every restart. The shared primitive
// fails fast in production when the env var is unset.
import { decryptSecret, encryptSecret, maskSecret } from "../_shared/cipher";

const encrypt = encryptSecret;
const decrypt = decryptSecret;

// allowlist: HEL-180b will migrate this to Postgres (table created in
// migration 054). Today still in-memory until the async refactor of
// service.ts callers is scoped.
const store = new Map<string, SlackCredential>();

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

// HEL-180: thin alias keeps the existing local helper name without
// re-defining the implementation. Future connectors should call
// `maskSecret` directly from `../_shared/cipher`.
const maskToken = maskSecret;

function upsertByUserAndTeam(credential: SlackCredential): void {
  for (const [id, existing] of store.entries()) {
    if (
      existing.userId === credential.userId &&
      existing.teamId === credential.teamId &&
      !existing.revokedAt
    ) {
      store.delete(id);
    }
  }
  store.set(credential.id, credential);
}

export const slackCredentialStore = {
  saveOAuth(params: {
    userId: string;
    accessToken: string;
    refreshToken?: string;
    scopes: string[];
    teamId: string;
    teamName?: string;
    metadata?: Record<string, string>;
  }): SlackCredentialPublic {
    const credential: SlackCredential = {
      id: randomUUID(),
      userId: params.userId,
      authMethod: "oauth2_pkce",
      tokenEncrypted: encrypt(params.accessToken),
      tokenMasked: maskToken(params.accessToken),
      refreshTokenEncrypted: params.refreshToken ? encrypt(params.refreshToken) : undefined,
      scopes: params.scopes,
      teamId: params.teamId,
      teamName: params.teamName,
      createdAt: new Date().toISOString(),
      metadata: params.metadata,
    };

    upsertByUserAndTeam(credential);
    return toPublic(credential);
  },

  saveApiKey(params: {
    userId: string;
    botToken: string;
    scopes?: string[];
    teamId: string;
    teamName?: string;
    metadata?: Record<string, string>;
  }): SlackCredentialPublic {
    const credential: SlackCredential = {
      id: randomUUID(),
      userId: params.userId,
      authMethod: "api_key",
      tokenEncrypted: encrypt(params.botToken),
      tokenMasked: maskToken(params.botToken),
      scopes: params.scopes ?? [],
      teamId: params.teamId,
      teamName: params.teamName,
      createdAt: new Date().toISOString(),
      metadata: params.metadata,
    };

    upsertByUserAndTeam(credential);
    return toPublic(credential);
  },

  getPublicByUser(userId: string): SlackCredentialPublic[] {
    return Array.from(store.values())
      .filter((credential) => credential.userId === userId)
      .map(toPublic);
  },

  getById(id: string, userId: string): SlackCredential | null {
    const credential = store.get(id);
    if (!credential || credential.userId !== userId || credential.revokedAt) {
      return null;
    }
    return credential;
  },

  getActiveByUser(userId: string): SlackCredential | null {
    const active = Array.from(store.values())
      .filter((credential) => credential.userId === userId && !credential.revokedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return active[0] ?? null;
  },

  decryptAccessToken(credential: SlackCredential): string {
    return decrypt(credential.tokenEncrypted);
  },

  decryptRefreshToken(credential: SlackCredential): string | null {
    if (!credential.refreshTokenEncrypted) return null;
    return decrypt(credential.refreshTokenEncrypted);
  },

  rotateToken(params: {
    credentialId: string;
    accessToken: string;
    refreshToken?: string;
    scopes?: string[];
  }): SlackCredentialPublic | null {
    const existing = store.get(params.credentialId);
    if (!existing || existing.revokedAt) return null;

    const updated: SlackCredential = {
      ...existing,
      tokenEncrypted: encrypt(params.accessToken),
      tokenMasked: maskToken(params.accessToken),
      refreshTokenEncrypted: params.refreshToken
        ? encrypt(params.refreshToken)
        : existing.refreshTokenEncrypted,
      scopes: params.scopes ?? existing.scopes,
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
