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

  get(id: string, userId: string): LLMConfigPublic | undefined {
    const cfg = store.get(id);
    if (!cfg || cfg.userId !== userId) return undefined;
    return toPublic(cfg);
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

  delete(id: string, userId: string): boolean {
    const cfg = store.get(id);
    if (!cfg || cfg.userId !== userId) return false;
    store.delete(id);
    return true;
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

  /** Returns the decrypted API key for LLM step execution. */
  getDecrypted(
    id: string,
    userId: string
  ): { config: LLMConfigPublic; apiKey: string } | undefined {
    const cfg = store.get(id);
    if (!cfg || cfg.userId !== userId) return undefined;
    return { config: toPublic(cfg), apiKey: decrypt(cfg.apiKeyEncrypted) };
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

  clear(): void {
    store.clear();
  },
};
