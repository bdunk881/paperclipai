import { randomUUID } from "node:crypto";
import { CredentialRegistry, CredentialRegistryRecord } from "../integrations/shared/credentialRegistry";
import {
  TicketSyncConnectionMetadata,
  TicketSyncConnectionPublic,
  TicketSyncConnectionSecrets,
} from "./types";

interface TicketSyncConnectionRecord extends CredentialRegistryRecord {
  label: string;
  metadata: TicketSyncConnectionMetadata;
  secretsEncrypted: string;
  updatedAt: string;
}

function toPublic(record: TicketSyncConnectionRecord): TicketSyncConnectionPublic {
  return {
    id: record.id,
    workspaceId: record.metadata.workspaceId,
    provider: record.metadata.provider,
    authMethod: record.metadata.authMethod,
    label: record.label,
    syncDirection: record.metadata.syncDirection,
    enabled: record.metadata.enabled,
    config: {
      ...record.metadata.config,
      hasWebhookSecret: Boolean(record.metadata.config.webhookSecret),
    },
    fieldMapping: record.metadata.fieldMapping,
    defaultAssignee: record.metadata.defaultAssignee,
    health: record.metadata.health,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revokedAt: record.revokedAt,
  };
}

const registry = new CredentialRegistry<TicketSyncConnectionRecord, TicketSyncConnectionPublic>({
  service: "ticket_sync_connections",
  toPublic,
  sortValue: (record) => record.updatedAt,
});

export const ticketSyncConnectionStore = {
  create(input: {
    userId: string;
    label: string;
    metadata: TicketSyncConnectionMetadata;
    secrets: TicketSyncConnectionSecrets;
  }): TicketSyncConnectionPublic {
    const now = new Date().toISOString();
    const record: TicketSyncConnectionRecord = {
      id: randomUUID(),
      userId: input.userId,
      label: input.label,
      metadata: input.metadata,
      secretsEncrypted: registry.encryptSecret(JSON.stringify(input.secrets)),
      createdAt: now,
      updatedAt: now,
    };

    return registry.toPublic(registry.save(record));
  },

  async listByWorkspace(workspaceId: string): Promise<TicketSyncConnectionPublic[]> {
    const records = await registry.listStoredAsync(false);
    return records
      .filter((record) => record.metadata.workspaceId === workspaceId)
      .map((record) => registry.toPublic(record));
  },

  async listByWorkspaceForUser(workspaceId: string, userId: string): Promise<TicketSyncConnectionPublic[]> {
    const records = await registry.listStoredAsync(false);
    return records
      .filter((record) => record.metadata.workspaceId === workspaceId && record.userId === userId)
      .map((record) => registry.toPublic(record));
  },

  async getById(id: string): Promise<TicketSyncConnectionPublic | null> {
    const record = await registry.getByIdAsync(id);
    if (!record || record.revokedAt) {
      return null;
    }

    return registry.toPublic(record);
  },

  async getByIdForUser(id: string, userId: string): Promise<TicketSyncConnectionPublic | null> {
    const record = await registry.getByIdAsync(id);
    if (!record || record.revokedAt || record.userId !== userId) {
      return null;
    }

    return registry.toPublic(record);
  },

  async getDecryptedById(id: string): Promise<{
    record: TicketSyncConnectionRecord;
    secrets: TicketSyncConnectionSecrets;
  } | null> {
    const record = await registry.getByIdAsync(id);
    if (!record || record.revokedAt) {
      return null;
    }

    return {
      record,
      secrets: JSON.parse(registry.decryptSecret(record.secretsEncrypted)) as TicketSyncConnectionSecrets,
    };
  },

  async updateHealth(id: string, health: TicketSyncConnectionMetadata["health"]): Promise<TicketSyncConnectionPublic | null> {
    const updated = registry.update(id, (record) => ({
      ...record,
      updatedAt: new Date().toISOString(),
      metadata: {
        ...record.metadata,
        health,
      },
    }));

    return updated ? registry.toPublic(updated) : null;
  },

  update(
    id: string,
    userId: string,
    mutate: (input: {
      record: TicketSyncConnectionRecord;
      secrets: TicketSyncConnectionSecrets;
    }) => {
      record?: TicketSyncConnectionRecord;
      secrets?: TicketSyncConnectionSecrets;
    },
  ): TicketSyncConnectionPublic | null {
    const updated = registry.update(id, (record) => {
      if (record.userId !== userId || record.revokedAt) {
        return record;
      }

      const existingSecrets = JSON.parse(registry.decryptSecret(record.secretsEncrypted)) as TicketSyncConnectionSecrets;
      const mutation = mutate({ record, secrets: existingSecrets });
      const nextRecord = mutation.record ?? record;
      const nextSecrets = mutation.secrets ?? existingSecrets;

      return {
        ...nextRecord,
        updatedAt: new Date().toISOString(),
        secretsEncrypted: registry.encryptSecret(JSON.stringify(nextSecrets)),
      };
    });

    if (!updated || updated.userId !== userId || updated.revokedAt) {
      return null;
    }

    return registry.toPublic(updated);
  },

  revoke(id: string, userId: string): boolean {
    const updated = registry.update(id, (record) => {
      if (record.userId !== userId || record.revokedAt) {
        return record;
      }

      return {
        ...record,
        updatedAt: new Date().toISOString(),
        revokedAt: new Date().toISOString(),
      };
    });

    return Boolean(updated && updated.userId === userId && updated.revokedAt);
  },

  clear(): void {
    registry.clear();
  },
};
