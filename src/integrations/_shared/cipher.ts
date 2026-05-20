/**
 * Shared AES-256-GCM secret cipher (HEL-180 Gap 1).
 *
 * Every connector credentialStore.ts in src/integrations/ used to copy-paste
 * the same 30 lines of encrypt/decrypt code. This module centralizes them
 * so:
 *
 *   1. The cryptographic primitive has ONE audit surface.
 *   2. The "missing CONNECTOR_CREDENTIAL_ENCRYPTION_KEY" failure is loud
 *      in production, not silently masked by a per-process random key
 *      that would invalidate every previously-stored credential on restart.
 *
 * Ciphertext format: `<iv_hex>:<auth_tag_hex>:<ciphertext_hex>`. Single
 * colon-delimited string so it stores cleanly in a single text column
 * without separate iv / auth_tag columns. Matches the format the
 * pre-shared connector stores used, so future migrations can decrypt
 * existing rows after the cutover.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const SCRYPT_SALT = "autoflow-connector-salt";

/**
 * In production we REQUIRE `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`. Without
 * it, every restart would invalidate every previously-stored credential
 * (since the random per-process key would change), which is the silent
 * failure the old per-connector cipher had. Tests + dev set the env var
 * explicitly via .env.test / .env.development.
 *
 * The key is derived ONCE at module load via scryptSync — that's the
 * expensive step, so we cache the derived buffer here.
 */
let cachedKey: Buffer | null = null;

function resolveKey(): Buffer {
  if (cachedKey) return cachedKey;
  const envKey = process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY;
  if (!envKey || envKey.trim().length === 0) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "CONNECTOR_CREDENTIAL_ENCRYPTION_KEY is required in production. " +
          "Without it, every API restart silently invalidates every saved " +
          "connector credential.",
      );
    }
    // Dev/test fallback: a deterministic key derived from the constant
    // below. This is INTENTIONAL — it lets `npm test` and `npm run dev`
    // round-trip without env setup, and lets the test pool persist
    // credentials across the suite. NEVER trust this key in production:
    // the resolve check above guarantees production fails fast.
    const fallback = "autoflow-dev-fallback-key-not-for-prod";
    cachedKey = scryptSync(fallback, SCRYPT_SALT, KEY_LEN) as Buffer;
    return cachedKey;
  }
  cachedKey = scryptSync(envKey, SCRYPT_SALT, KEY_LEN) as Buffer;
  return cachedKey;
}

/**
 * For tests that want to swap the key mid-suite (e.g. to verify that a
 * different key fails to decrypt previously-encrypted ciphertext).
 * Production code must never call this.
 */
export function __resetCipherKeyCache(): void {
  cachedKey = null;
}

/**
 * Encrypts an arbitrary UTF-8 plaintext string. Returns a single
 * colon-delimited ciphertext that round-trips through `decryptSecret`.
 */
export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== "string") {
    throw new TypeError("encryptSecret expects a string");
  }
  const key = resolveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts a ciphertext produced by `encryptSecret`. Throws on:
 *  - malformed format (wrong number of colon-separated parts)
 *  - bad auth tag (tampered ciphertext)
 *  - wrong key (different `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`)
 */
export function decryptSecret(ciphertext: string): string {
  if (typeof ciphertext !== "string") {
    throw new TypeError("decryptSecret expects a string");
  }
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid ciphertext format: expected iv:tag:data");
  }
  const [ivHex, tagHex, dataHex] = parts;
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Invalid ciphertext format: empty segment");
  }
  const key = resolveKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(dataHex, "hex")).toString("utf8") + decipher.final("utf8");
}

/**
 * Masks a plaintext token for UI display. Returns `****<last4>`, never
 * leaks any prefix of the secret. Identical helper across every
 * connector store today; centralized here so we don't bikeshed.
 */
export function maskSecret(plaintext: string): string {
  if (!plaintext) return "****";
  return `****${plaintext.slice(-4)}`;
}
