import {
  LLMProviderCredentialSummary,
  LLMProviderCredentials,
  LLMProviderOptions,
  ProviderName,
} from "../engine/llmProviders/types";
import { CentralCredentialStore } from "../integrations/shared/centralCredentialStore";

export type LLMProvider = ProviderName;

interface LLMConfigMetadata {
  provider: LLMProvider;
  model: string;
  credentialSummary: LLMProviderCredentialSummary;
  apiKeyMasked?: string;
  providerOptions?: LLMProviderOptions;
  isDefault: boolean;
}

interface LLMStoredConfig {
  id: string;
  userId: string;
  provider: LLMProvider;
  label: string;
  model: string;
  credentialSummary: LLMProviderCredentialSummary;
  apiKeyMasked?: string;
  providerOptions?: LLMProviderOptions;
  isDefault: boolean;
  createdAt: string;
}

export interface LLMConfig extends LLMStoredConfig {
  credentialsEncrypted: string;
}

export type LLMConfigPublic = LLMStoredConfig;

export interface DecryptedLLMConfig {
  config: LLMConfigPublic;
  credentials: LLMProviderCredentials;
  apiKey?: string;
}

const CREDENTIAL_MASK_KEYS: Record<keyof LLMProviderCredentials, keyof LLMProviderCredentialSummary> = {
  apiKey: "apiKeyMasked",
  accessKeyId: "accessKeyIdMasked",
  secretAccessKey: "secretAccessKeyMasked",
  sessionToken: "sessionTokenMasked",
  serviceAccountJson: "serviceAccountJsonMasked",
  oauthAccessToken: "oauthAccessTokenMasked",
};

function maskSecret(secret: string): string {
  if (!secret) {
    return "****";
  }

  const suffix = secret.length > 4 ? secret.slice(-4) : secret;
  return `****${suffix}`;
}

function normalizeCredentials(
  credentials: LLMProviderCredentials | undefined,
): LLMProviderCredentials {
  if (!credentials) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(credentials).filter(([, value]) => typeof value === "string" && value.length > 0),
  ) as LLMProviderCredentials;
}

function summarizeCredentials(
  credentials: LLMProviderCredentials,
): LLMProviderCredentialSummary {
  const summary: LLMProviderCredentialSummary = {};

  (Object.keys(CREDENTIAL_MASK_KEYS) as Array<keyof LLMProviderCredentials>).forEach((key) => {
    const value = credentials[key];
    if (typeof value === "string" && value.length > 0) {
      summary[CREDENTIAL_MASK_KEYS[key]] = maskSecret(value);
    }
  });

  return summary;
}

function toPublic(record: {
  id: string;
  userId: string;
  label: string;
  createdAt: string;
  metadata: LLMConfigMetadata;
}): LLMConfigPublic {
  return {
    id: record.id,
    userId: record.userId,
    provider: record.metadata.provider,
    label: record.label,
    model: record.metadata.model,
    credentialSummary: record.metadata.credentialSummary,
    apiKeyMasked: record.metadata.apiKeyMasked,
    providerOptions: record.metadata.providerOptions,
    isDefault: record.metadata.isDefault,
    createdAt: record.createdAt,
  };
}

const store = new CentralCredentialStore<LLMConfigMetadata, LLMProviderCredentials>({
  service: "llm-config",
});

export const llmConfigStore = {
  create(params: {
    userId: string;
    provider: LLMProvider;
    label: string;
    model: string;
    credentials: LLMProviderCredentials;
    providerOptions?: LLMProviderOptions;
  }): LLMConfigPublic {
    const normalizedCredentials = normalizeCredentials(params.credentials);
    const credentialSummary = summarizeCredentials(normalizedCredentials);

    const record = store.create({
      userId: params.userId,
      authMethod: params.provider,
      label: params.label,
      metadata: {
        provider: params.provider,
        model: params.model,
        credentialSummary,
        apiKeyMasked: credentialSummary.apiKeyMasked,
        providerOptions: params.providerOptions,
        isDefault: false,
      },
      secrets: normalizedCredentials,
    });

    return toPublic(record);
  },

  list(userId: string): LLMConfigPublic[] {
    return store.listByUser(userId, false).map(toPublic);
  },

  get(id: string, userId: string): LLMConfigPublic | undefined {
    const record = store.getById(id);
    if (!record || record.userId !== userId || record.revokedAt) {
      return undefined;
    }
    return toPublic(record);
  },

  update(
    id: string,
    userId: string,
    patch: Partial<{
      label: string;
      model: string;
      credentials: LLMProviderCredentials;
      providerOptions?: LLMProviderOptions;
    }>,
  ): LLMConfigPublic | undefined {
    const updated = store.update(id, (existing, secrets) => {
      if (existing.userId !== userId || existing.revokedAt) {
        return {};
      }

      const nextCredentials = normalizeCredentials(patch.credentials ?? secrets);
      const credentialSummary = summarizeCredentials(nextCredentials);
      return {
        record: {
          ...existing,
          label: patch.label ?? existing.label,
          updatedAt: new Date().toISOString(),
          metadata: {
            ...existing.metadata,
            model: patch.model ?? existing.metadata.model,
            providerOptions: patch.providerOptions ?? existing.metadata.providerOptions,
            credentialSummary,
            apiKeyMasked: credentialSummary.apiKeyMasked,
          },
        },
        secrets: nextCredentials,
      };
    });

    if (!updated || updated.userId !== userId || updated.revokedAt) {
      return undefined;
    }

    return toPublic(updated);
  },

  delete(id: string, userId: string): boolean {
    const existing = store.getById(id);
    if (!existing || existing.userId !== userId || existing.revokedAt) {
      return false;
    }
    return store.delete(id);
  },

  setDefault(id: string, userId: string): LLMConfigPublic | undefined {
    const target = store.getById(id);
    if (!target || target.userId !== userId || target.revokedAt) {
      return undefined;
    }

    for (const record of store.listByUser(userId, false)) {
      if (record.metadata.isDefault) {
        store.update(record.id, (existing, secrets) => ({
          record: {
            ...existing,
            updatedAt: new Date().toISOString(),
            metadata: {
              ...existing.metadata,
              isDefault: false,
            },
          },
          secrets,
        }));
      }
    }

    const updated = store.update(id, (existing, secrets) => ({
      record: {
        ...existing,
        updatedAt: new Date().toISOString(),
        metadata: {
          ...existing.metadata,
          isDefault: true,
        },
      },
      secrets,
    }));

    return updated ? toPublic(updated) : undefined;
  },

  getDecrypted(id: string, userId: string): DecryptedLLMConfig | undefined {
    const decrypted = store.getDecrypted(id);
    if (!decrypted || decrypted.record.userId !== userId || decrypted.record.revokedAt) {
      return undefined;
    }

    return {
      config: toPublic(decrypted.record),
      credentials: decrypted.secrets,
      apiKey: decrypted.secrets.apiKey,
    };
  },

  getDecryptedDefault(userId: string): DecryptedLLMConfig | undefined {
    const record = store.findLatest(
      (existing) => existing.userId === userId && existing.metadata.isDefault && !existing.revokedAt,
    );
    if (!record) {
      return undefined;
    }

    const decrypted = store.getDecrypted(record.id);
    if (!decrypted) {
      return undefined;
    }

    return {
      config: toPublic(decrypted.record),
      credentials: decrypted.secrets,
      apiKey: decrypted.secrets.apiKey,
    };
  },

  clear(): void {
    store.clear();
  },
};
