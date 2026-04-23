import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";
import { randomUUID } from "node:crypto";
import { ShopifyCredential, ShopifyCredentialPublic } from "./types";

const ENCRYPTION_KEY: Buffer = (() => {
  const envKey = process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY;
  if (envKey) {
    return scryptSync(envKey, "autoflow-connector-salt", 32) as Buffer;
  }
  return randomBytes(32);
})();

function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decrypt(ciphertext: string): string {
  const [ivHex, tagHex, dataHex] = ciphertext.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Invalid ciphertext format");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    ENCRYPTION_KEY,
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(dataHex, "hex")).toString("utf8") + decipher.final("utf8");
}

const store = new Map<string, ShopifyCredential>();

function toPublic(credential: ShopifyCredential): ShopifyCredentialPublic {
  return {
    id: credential.id,
    userId: credential.userId,
    authMethod: credential.authMethod,
    tokenMasked: credential.tokenMasked,
    scopes: credential.scopes,
    shopDomain: credential.shopDomain,
    createdAt: credential.createdAt,
    revokedAt: credential.revokedAt,
  };
}

function maskToken(value: string): string {
  const tail = value.slice(-4);
  return `****${tail}`;
}

function normalizeShopDomain(shopDomain: string): string {
  const trimmed = shopDomain.trim().toLowerCase();
  if (!trimmed) return "";

  const withoutProtocol = trimmed.replace(/^https?:\/\//, "");
  return withoutProtocol.replace(/\/$/, "");
}

function upsertByUserAndShop(credential: ShopifyCredential): void {
  for (const [id, existing] of store.entries()) {
    if (
      existing.userId === credential.userId &&
      existing.shopDomain === credential.shopDomain &&
      !existing.revokedAt
    ) {
      store.delete(id);
    }
  }
  store.set(credential.id, credential);
}

export const shopifyCredentialStore = {
  saveOAuth(params: {
    userId: string;
    accessToken: string;
    scopes: string[];
    shopDomain: string;
    metadata?: Record<string, string>;
  }): ShopifyCredentialPublic {
    const credential: ShopifyCredential = {
      id: randomUUID(),
      userId: params.userId,
      authMethod: "oauth2_pkce",
      tokenEncrypted: encrypt(params.accessToken),
      tokenMasked: maskToken(params.accessToken),
      scopes: params.scopes,
      shopDomain: normalizeShopDomain(params.shopDomain),
      createdAt: new Date().toISOString(),
      metadata: params.metadata,
    };

    upsertByUserAndShop(credential);
    return toPublic(credential);
  },

  saveApiKey(params: {
    userId: string;
    adminApiToken: string;
    scopes?: string[];
    shopDomain: string;
    metadata?: Record<string, string>;
  }): ShopifyCredentialPublic {
    const credential: ShopifyCredential = {
      id: randomUUID(),
      userId: params.userId,
      authMethod: "api_key",
      tokenEncrypted: encrypt(params.adminApiToken),
      tokenMasked: maskToken(params.adminApiToken),
      scopes: params.scopes ?? [],
      shopDomain: normalizeShopDomain(params.shopDomain),
      createdAt: new Date().toISOString(),
      metadata: params.metadata,
    };

    upsertByUserAndShop(credential);
    return toPublic(credential);
  },

  getPublicByUser(userId: string): ShopifyCredentialPublic[] {
    return Array.from(store.values())
      .filter((credential) => credential.userId === userId)
      .map(toPublic);
  },

  getById(id: string, userId: string): ShopifyCredential | null {
    const credential = store.get(id);
    if (!credential || credential.userId !== userId || credential.revokedAt) {
      return null;
    }
    return credential;
  },

  getActiveByUser(userId: string): ShopifyCredential | null {
    const active = Array.from(store.values())
      .filter((credential) => credential.userId === userId && !credential.revokedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return active[0] ?? null;
  },

  decryptAccessToken(credential: ShopifyCredential): string {
    return decrypt(credential.tokenEncrypted);
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
