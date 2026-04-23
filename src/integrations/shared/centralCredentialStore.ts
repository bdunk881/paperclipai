import { v4 as uuidv4 } from "uuid";

import { CredentialRegistry, CredentialRegistryRecord } from "./credentialRegistry";

export interface CentralCredentialRecord<TMetadata extends object> extends CredentialRegistryRecord {
  authMethod: string;
  label: string;
  updatedAt: string;
  metadata: TMetadata;
  secretPayloadEncrypted: string;
}

export interface CentralCredentialDecrypted<TMetadata extends object, TSecrets extends object> {
  record: CentralCredentialRecord<TMetadata>;
  secrets: TSecrets;
}

interface CentralCredentialStoreOptions<TMetadata extends object> {
  service: string;
  sortValue?: (record: CentralCredentialRecord<TMetadata>) => string;
}

export class CentralCredentialStore<TMetadata extends object, TSecrets extends object> {
  private readonly registry: CredentialRegistry<
    CentralCredentialRecord<TMetadata>,
    CentralCredentialRecord<TMetadata>
  >;

  constructor(options: CentralCredentialStoreOptions<TMetadata>) {
    this.registry = new CredentialRegistry<CentralCredentialRecord<TMetadata>, CentralCredentialRecord<TMetadata>>({
      service: options.service,
      toPublic: (record) => record,
      sortValue: options.sortValue,
    });
  }

  create(params: {
    userId: string;
    authMethod: string;
    label: string;
    metadata: TMetadata;
    secrets: TSecrets;
    id?: string;
    createdAt?: string;
    updatedAt?: string;
    revokedAt?: string;
  }): CentralCredentialRecord<TMetadata> {
    const now = params.createdAt ?? new Date().toISOString();
    const record: CentralCredentialRecord<TMetadata> = {
      id: params.id ?? uuidv4(),
      userId: params.userId,
      authMethod: params.authMethod,
      label: params.label,
      createdAt: now,
      updatedAt: params.updatedAt ?? now,
      revokedAt: params.revokedAt,
      metadata: params.metadata,
      secretPayloadEncrypted: this.registry.encryptSecret(JSON.stringify(params.secrets)),
    };

    return this.registry.save(record);
  }

  listByUser(userId: string, includeRevoked = true): CentralCredentialRecord<TMetadata>[] {
    return this.registry.listStoredByUser(userId, includeRevoked);
  }

  async listByUserAsync(
    userId: string,
    includeRevoked = true,
  ): Promise<CentralCredentialRecord<TMetadata>[]> {
    return this.registry.listStoredByUserAsync(userId, includeRevoked);
  }

  getById(id: string): CentralCredentialRecord<TMetadata> | null {
    return this.registry.getById(id);
  }

  async getByIdAsync(id: string): Promise<CentralCredentialRecord<TMetadata> | null> {
    return this.registry.getByIdAsync(id);
  }

  findLatest(
    predicate: (record: CentralCredentialRecord<TMetadata>) => boolean,
    includeRevoked = false,
  ): CentralCredentialRecord<TMetadata> | null {
    return this.registry.findLatest(predicate, includeRevoked);
  }

  async findLatestAsync(
    predicate: (record: CentralCredentialRecord<TMetadata>) => boolean,
    includeRevoked = false,
  ): Promise<CentralCredentialRecord<TMetadata> | null> {
    return this.registry.findLatestAsync(predicate, includeRevoked);
  }

  getDecrypted(id: string): CentralCredentialDecrypted<TMetadata, TSecrets> | null {
    const record = this.registry.getById(id);
    if (!record) {
      return null;
    }

    return {
      record,
      secrets: this.decodeSecrets(record.secretPayloadEncrypted),
    };
  }

  async getDecryptedAsync(id: string): Promise<CentralCredentialDecrypted<TMetadata, TSecrets> | null> {
    const record = await this.registry.getByIdAsync(id);
    if (!record) {
      return null;
    }

    return {
      record,
      secrets: this.decodeSecrets(record.secretPayloadEncrypted),
    };
  }

  update(
    id: string,
    mutate: (
      record: CentralCredentialRecord<TMetadata>,
      secrets: TSecrets,
    ) => {
      record?: CentralCredentialRecord<TMetadata>;
      secrets?: TSecrets;
    },
  ): CentralCredentialRecord<TMetadata> | null {
    return this.registry.update(id, (existing) => {
      const existingSecrets = this.decodeSecrets(existing.secretPayloadEncrypted);
      const mutation = mutate(existing, existingSecrets);
      const nextRecord = mutation.record ?? existing;
      const nextSecrets = mutation.secrets ?? existingSecrets;
      return {
        ...nextRecord,
        secretPayloadEncrypted: this.registry.encryptSecret(JSON.stringify(nextSecrets)),
      };
    });
  }

  delete(id: string): boolean {
    const existing = this.registry.getById(id);
    if (!existing) {
      return false;
    }

    this.registry.purge((record) => record.id === id);
    return true;
  }

  clear(): void {
    this.registry.clear();
  }

  private decodeSecrets(ciphertext: string): TSecrets {
    const parsed = JSON.parse(this.registry.decryptSecret(ciphertext)) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("Invalid secret payload");
    }

    return parsed as TSecrets;
  }
}
