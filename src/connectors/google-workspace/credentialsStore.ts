import { CentralCredentialStore } from "../../integrations/shared/centralCredentialStore";

export type GoogleWorkspaceAuthMethod = "oauth_pkce" | "api_key";
export type GoogleWorkspaceCredentialStatus = "pending_validation" | "active" | "revoked";

interface GoogleWorkspaceCredentialMetadata {
  status: GoogleWorkspaceCredentialStatus;
  lastValidatedAt: string | null;
  tokenRefreshFailures: number;
  clientId?: string;
  redirectUri?: string;
  scopesRequested?: string[];
  scopesGranted?: string[];
  accessTokenExpiresAt?: string | null;
  apiKeyMasked?: string;
}

interface GoogleWorkspaceCredentialSecrets {
  oauthClientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  webhookSigningSecret?: string;
}

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
  accessTokenExpiresAt?: string | null;
  apiKeyMasked?: string;
  revokedAt?: string;
}

export interface GoogleWorkspaceCredentialDecrypted extends GoogleWorkspaceCredential {
  oauthClientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  webhookSigningSecret?: string;
}

export type GoogleWorkspaceCredentialPublic = GoogleWorkspaceCredential;

const store = new CentralCredentialStore<
  GoogleWorkspaceCredentialMetadata,
  GoogleWorkspaceCredentialSecrets
>({
  service: "google-workspace",
});

function maskSecret(secret: string): string {
  return `****${secret.slice(-4)}`;
}

function toPublic(record: {
  id: string;
  userId: string;
  label: string;
  authMethod: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  metadata: GoogleWorkspaceCredentialMetadata;
}): GoogleWorkspaceCredentialPublic {
  return {
    id: record.id,
    userId: record.userId,
    label: record.label,
    authMethod: record.authMethod as GoogleWorkspaceAuthMethod,
    status: record.metadata.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastValidatedAt: record.metadata.lastValidatedAt,
    tokenRefreshFailures: record.metadata.tokenRefreshFailures,
    clientId: record.metadata.clientId,
    redirectUri: record.metadata.redirectUri,
    scopesRequested: record.metadata.scopesRequested,
    scopesGranted: record.metadata.scopesGranted,
    accessTokenExpiresAt: record.metadata.accessTokenExpiresAt,
    apiKeyMasked: record.metadata.apiKeyMasked,
    revokedAt: record.revokedAt,
  };
}

function toDecrypted(record: {
  id: string;
  userId: string;
  label: string;
  authMethod: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  metadata: GoogleWorkspaceCredentialMetadata;
}, secrets: GoogleWorkspaceCredentialSecrets): GoogleWorkspaceCredentialDecrypted {
  return {
    ...toPublic(record),
    oauthClientSecret: secrets.oauthClientSecret,
    accessToken: secrets.accessToken,
    refreshToken: secrets.refreshToken,
    apiKey: secrets.apiKey,
    webhookSigningSecret: secrets.webhookSigningSecret,
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
    const record = store.create({
      userId: params.userId,
      authMethod: "oauth_pkce",
      label: params.label,
      metadata: {
        status: "pending_validation",
        lastValidatedAt: null,
        tokenRefreshFailures: 0,
        clientId: params.clientId,
        redirectUri: params.redirectUri,
        scopesRequested: params.scopesRequested,
      },
      secrets: {
        oauthClientSecret: params.clientSecret,
        webhookSigningSecret: params.webhookSigningSecret,
      },
    });

    return toPublic(record);
  },

  createApiKey(params: {
    userId: string;
    label: string;
    apiKey: string;
    webhookSigningSecret?: string;
  }): GoogleWorkspaceCredentialPublic {
    const record = store.create({
      userId: params.userId,
      authMethod: "api_key",
      label: params.label,
      metadata: {
        status: "pending_validation",
        lastValidatedAt: null,
        tokenRefreshFailures: 0,
        apiKeyMasked: maskSecret(params.apiKey),
      },
      secrets: {
        apiKey: params.apiKey,
        webhookSigningSecret: params.webhookSigningSecret,
      },
    });

    return toPublic(record);
  },

  list(userId: string): GoogleWorkspaceCredentialPublic[] {
    return store.listByUser(userId).map(toPublic);
  },

  get(id: string, userId: string): GoogleWorkspaceCredentialPublic | undefined {
    const record = store.getById(id);
    if (!record || record.userId !== userId) {
      return undefined;
    }
    return toPublic(record);
  },

  getAnyById(id: string): GoogleWorkspaceCredentialDecrypted | undefined {
    const decrypted = store.getDecrypted(id);
    if (!decrypted || decrypted.record.metadata.status === "revoked") {
      return undefined;
    }
    return toDecrypted(decrypted.record, decrypted.secrets);
  },

  getDecrypted(id: string, userId: string): GoogleWorkspaceCredentialDecrypted | undefined {
    const decrypted = store.getDecrypted(id);
    if (
      !decrypted ||
      decrypted.record.userId !== userId ||
      decrypted.record.metadata.status === "revoked"
    ) {
      return undefined;
    }
    return toDecrypted(decrypted.record, decrypted.secrets);
  },

  markValidated(id: string, userId: string): GoogleWorkspaceCredentialPublic | undefined {
    const updated = store.update(id, (existing, secrets) => {
      if (existing.userId !== userId || existing.metadata.status === "revoked") {
        return {};
      }

      const now = new Date().toISOString();
      return {
        record: {
          ...existing,
          updatedAt: now,
          metadata: {
            ...existing.metadata,
            status: "active",
            lastValidatedAt: now,
          },
        },
        secrets,
      };
    });

    if (!updated || updated.userId !== userId || updated.metadata.status === "revoked") {
      return undefined;
    }

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
    const updated = store.update(params.id, (existing, secrets) => {
      if (existing.userId !== params.userId || existing.metadata.status === "revoked") {
        return {};
      }

      const now = new Date().toISOString();
      return {
        record: {
          ...existing,
          updatedAt: now,
          metadata: {
            ...existing.metadata,
            status: "active",
            lastValidatedAt: now,
            tokenRefreshFailures: 0,
            accessTokenExpiresAt: params.expiresAt ?? null,
            scopesGranted: params.scopesGranted ?? existing.metadata.scopesGranted ?? existing.metadata.scopesRequested,
          },
        },
        secrets: {
          ...secrets,
          accessToken: params.accessToken,
          refreshToken: params.refreshToken ?? secrets.refreshToken,
        },
      };
    });

    if (!updated || updated.userId !== params.userId || updated.metadata.status === "revoked") {
      return undefined;
    }

    return toPublic(updated);
  },

  recordTokenRefreshFailure(id: string, userId: string): GoogleWorkspaceCredentialPublic | undefined {
    const updated = store.update(id, (existing, secrets) => {
      if (existing.userId !== userId || existing.metadata.status === "revoked") {
        return {};
      }

      return {
        record: {
          ...existing,
          updatedAt: new Date().toISOString(),
          metadata: {
            ...existing.metadata,
            tokenRefreshFailures: existing.metadata.tokenRefreshFailures + 1,
          },
        },
        secrets,
      };
    });

    if (!updated || updated.userId !== userId || updated.metadata.status === "revoked") {
      return undefined;
    }

    return toPublic(updated);
  },

  revoke(id: string, userId: string): GoogleWorkspaceCredentialPublic | undefined {
    const updated = store.update(id, (existing, secrets) => {
      if (existing.userId !== userId) {
        return {};
      }

      const now = new Date().toISOString();
      return {
        record: {
          ...existing,
          updatedAt: now,
          revokedAt: now,
          metadata: {
            ...existing.metadata,
            status: "revoked",
          },
        },
        secrets,
      };
    });

    if (!updated || updated.userId !== userId) {
      return undefined;
    }

    return toPublic(updated);
  },

  health(userId: string): {
    status: "ok" | "degraded";
    connector: "google_workspace";
    total: number;
    active: number;
    pendingValidation: number;
    revoked: number;
  } {
    const credentials = store.listByUser(userId);
    const active = credentials.filter((entry) => entry.metadata.status === "active").length;
    const pendingValidation = credentials.filter(
      (entry) => entry.metadata.status === "pending_validation",
    ).length;
    const revoked = credentials.filter((entry) => entry.metadata.status === "revoked").length;

    return {
      status: revoked > 0 ? "degraded" : "ok",
      connector: "google_workspace",
      total: credentials.length,
      active,
      pendingValidation,
      revoked,
    };
  },

  clear(): void {
    store.clear();
  },
};
