/**
 * In-memory LLM provider config store with AES-256-GCM encrypted key storage.
 * Replace with a database-backed store for production.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";
import { v4 as uuidv4 } from "uuid";
import { isPostgresConfigured, queryPostgres } from "../db/postgres";

export type LLMProvider = "openai" | "anthropic" | "gemini" | "mistral";

export interface LLMConfig {
  id: string;
  userId: string;
  provider: LLMProvider;
  label: string;
  model: string;
  /** AES-256-GCM ciphertext. Never returned in API responses. */
  apiKeyEncrypted: string;
  /** Last 4 chars of the original key, e.g. "****abcd". */
  apiKeyMasked: string;
  isDefault: boolean;
  createdAt: string;
}

export type LLMConfigPublic = Omit<LLMConfig, "apiKeyEncrypted">;

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

const ENCRYPTION_KEY: Buffer = (() => {
  const envKey = process.env.LLM_CONFIG_ENCRYPTION_KEY;
  if (envKey) {
    return scryptSync(envKey, "autoflow-llm-salt", 32) as Buffer;
  }
  // Dev/test: random key per process (not portable across restarts — acceptable for in-memory store)
  return randomBytes(32);
})();

function encrypt(plaintext: string): string {
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Encoded as "iv:tag:ciphertext" (all hex)
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid ciphertext format");
  const [ivHex, tagHex, encHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const enc = Buffer.from(encHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc).toString("utf8") + decipher.final("utf8");
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const store = new Map<string, LLMConfig>();

interface PersistedLlmConfigRow {
  id: string;
  user_id: string;
  provider: LLMProvider;
  label: string;
  model: string;
  api_key_encrypted: string;
  api_key_masked: string;
  is_default: boolean;
  created_at: Date | string;
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapPersistedConfig(row: PersistedLlmConfigRow): LLMConfig {
  const config: LLMConfig = {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    label: row.label,
    model: row.model,
    apiKeyEncrypted: row.api_key_encrypted,
    apiKeyMasked: row.api_key_masked,
    isDefault: row.is_default,
    createdAt: toIsoString(row.created_at),
  };
  store.set(config.id, config);
  return config;
}

async function persistConfig(config: LLMConfig): Promise<void> {
  if (!isPostgresConfigured()) {
    return;
  }

  if (config.isDefault) {
    await queryPostgres(
      "UPDATE llm_configs SET is_default = false WHERE user_id = $1 AND id <> $2",
      [config.userId, config.id]
    );
  }

  await queryPostgres(
    `INSERT INTO llm_configs (
      id,
      user_id,
      provider,
      label,
      model,
      api_key_encrypted,
      api_key_masked,
      is_default,
      created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
    ON CONFLICT (id) DO UPDATE SET
      provider = EXCLUDED.provider,
      label = EXCLUDED.label,
      model = EXCLUDED.model,
      api_key_encrypted = EXCLUDED.api_key_encrypted,
      api_key_masked = EXCLUDED.api_key_masked,
      is_default = EXCLUDED.is_default`,
    [
      config.id,
      config.userId,
      config.provider,
      config.label,
      config.model,
      config.apiKeyEncrypted,
      config.apiKeyMasked,
      config.isDefault,
      config.createdAt,
    ]
  );
}

async function deletePersistedConfig(id: string, userId: string): Promise<boolean> {
  if (!isPostgresConfigured()) {
    return false;
  }

  const result = await queryPostgres(
    "DELETE FROM llm_configs WHERE id = $1 AND user_id = $2",
    [id, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

function toPublic(cfg: LLMConfig): LLMConfigPublic {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { apiKeyEncrypted: _enc, ...pub } = cfg;
  return pub;
}

export const llmConfigStore = {
  create(params: {
    userId: string;
    provider: LLMProvider;
    label: string;
    model: string;
    apiKey: string;
  }): LLMConfigPublic {
    const apiKeyMasked = `****${params.apiKey.slice(-4)}`;
    const cfg: LLMConfig = {
      id: uuidv4(),
      userId: params.userId,
      provider: params.provider,
      label: params.label,
      model: params.model,
      apiKeyEncrypted: encrypt(params.apiKey),
      apiKeyMasked,
      isDefault: false,
      createdAt: new Date().toISOString(),
    };
    store.set(cfg.id, cfg);
    return toPublic(cfg);
  },

  list(userId: string): LLMConfigPublic[] {
    return Array.from(store.values())
      .filter((c) => c.userId === userId)
      .map(toPublic);
  },

  async listAsync(userId: string): Promise<LLMConfigPublic[]> {
    const local = this.list(userId);
    if (local.length > 0 || !isPostgresConfigured()) {
      return local;
    }

    const result = await queryPostgres<PersistedLlmConfigRow>(
      "SELECT * FROM llm_configs WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );
    return result.rows.map(mapPersistedConfig).map(toPublic);
  },

  get(id: string, userId: string): LLMConfigPublic | undefined {
    const cfg = store.get(id);
    if (!cfg || cfg.userId !== userId) return undefined;
    return toPublic(cfg);
  },

  async getAsync(id: string, userId: string): Promise<LLMConfigPublic | undefined> {
    const local = this.get(id, userId);
    if (local || !isPostgresConfigured()) {
      return local;
    }

    const result = await queryPostgres<PersistedLlmConfigRow>(
      "SELECT * FROM llm_configs WHERE id = $1 AND user_id = $2",
      [id, userId]
    );
    const row = result.rows[0];
    return row ? toPublic(mapPersistedConfig(row)) : undefined;
  },

  update(
    id: string,
    userId: string,
    patch: Partial<Pick<LLMConfig, "label" | "model">>
  ): LLMConfigPublic | undefined {
    const cfg = store.get(id);
    if (!cfg || cfg.userId !== userId) return undefined;
    const updated = { ...cfg, ...patch };
    store.set(id, updated);
    return toPublic(updated);
  },

  async updateAsync(
    id: string,
    userId: string,
    patch: Partial<Pick<LLMConfig, "label" | "model">>
  ): Promise<LLMConfigPublic | undefined> {
    const existing =
      store.get(id)?.userId === userId
        ? store.get(id)
        : isPostgresConfigured()
          ? (await queryPostgres<PersistedLlmConfigRow>(
              "SELECT * FROM llm_configs WHERE id = $1 AND user_id = $2",
              [id, userId]
            )).rows[0]
          : undefined;

    if (!existing) {
      return undefined;
    }

    const base = existing instanceof Object && "user_id" in existing
      ? mapPersistedConfig(existing as PersistedLlmConfigRow)
      : (existing as LLMConfig);
    const updated = { ...base, ...patch };
    store.set(id, updated);
    await persistConfig(updated);
    return toPublic(updated);
  },

  delete(id: string, userId: string): boolean {
    const cfg = store.get(id);
    if (!cfg || cfg.userId !== userId) return false;
    store.delete(id);
    return true;
  },

  async deleteAsync(id: string, userId: string): Promise<boolean> {
    const local = store.get(id);
    if (local?.userId === userId) {
      store.delete(id);
    }

    const deletedPersisted = await deletePersistedConfig(id, userId);
    return Boolean(local?.userId === userId || deletedPersisted);
  },

  setDefault(id: string, userId: string): LLMConfigPublic | undefined {
    const target = store.get(id);
    if (!target || target.userId !== userId) return undefined;

    // Clear previous default for this user
    for (const cfg of store.values()) {
      if (cfg.userId === userId && cfg.isDefault) {
        store.set(cfg.id, { ...cfg, isDefault: false });
      }
    }

    const updated = { ...target, isDefault: true };
    store.set(id, updated);
    return toPublic(updated);
  },

  async setDefaultAsync(id: string, userId: string): Promise<LLMConfigPublic | undefined> {
    let target = store.get(id);
    if ((!target || target.userId !== userId) && isPostgresConfigured()) {
      const result = await queryPostgres<PersistedLlmConfigRow>(
        "SELECT * FROM llm_configs WHERE id = $1 AND user_id = $2",
        [id, userId]
      );
      const row = result.rows[0];
      target = row ? mapPersistedConfig(row) : undefined;
    }

    if (!target || target.userId !== userId) {
      return undefined;
    }

    for (const cfg of store.values()) {
      if (cfg.userId === userId && cfg.isDefault && cfg.id !== id) {
        store.set(cfg.id, { ...cfg, isDefault: false });
      }
    }

    const updated = { ...target, isDefault: true };
    store.set(id, updated);
    await persistConfig(updated);
    return toPublic(updated);
  },

  /** Returns the decrypted API key for LLM step execution. */
  getDecrypted(
    id: string,
    userId: string
  ): { config: LLMConfigPublic; apiKey: string } | undefined {
    const cfg = store.get(id);
    if (!cfg || cfg.userId !== userId) return undefined;
    return { config: toPublic(cfg), apiKey: decrypt(cfg.apiKeyEncrypted) };
  },

  async getDecryptedAsync(
    id: string,
    userId: string
  ): Promise<{ config: LLMConfigPublic; apiKey: string } | undefined> {
    const local = this.getDecrypted(id, userId);
    if (local || !isPostgresConfigured()) {
      return local;
    }

    const result = await queryPostgres<PersistedLlmConfigRow>(
      "SELECT * FROM llm_configs WHERE id = $1 AND user_id = $2",
      [id, userId]
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    const config = mapPersistedConfig(row);
    return { config: toPublic(config), apiKey: decrypt(config.apiKeyEncrypted) };
  },

  /** Returns the user's default config with decrypted API key, if set. */
  getDecryptedDefault(
    userId: string
  ): { config: LLMConfigPublic; apiKey: string } | undefined {
    for (const cfg of store.values()) {
      if (cfg.userId === userId && cfg.isDefault) {
        return { config: toPublic(cfg), apiKey: decrypt(cfg.apiKeyEncrypted) };
      }
    }
    return undefined;
  },

  async getDecryptedDefaultAsync(
    userId: string
  ): Promise<{ config: LLMConfigPublic; apiKey: string } | undefined> {
    const local = this.getDecryptedDefault(userId);
    if (local || !isPostgresConfigured()) {
      return local;
    }

    const result = await queryPostgres<PersistedLlmConfigRow>(
      "SELECT * FROM llm_configs WHERE user_id = $1 AND is_default = true LIMIT 1",
      [userId]
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    const config = mapPersistedConfig(row);
    return { config: toPublic(config), apiKey: decrypt(config.apiKeyEncrypted) };
  },

  async createAsync(params: {
    userId: string;
    provider: LLMProvider;
    label: string;
    model: string;
    apiKey: string;
  }): Promise<LLMConfigPublic> {
    const created = this.create(params);
    const stored = store.get(created.id);
    if (stored) {
      await persistConfig(stored);
    }
    return created;
  },

  clear(): void {
    store.clear();
  },
};
