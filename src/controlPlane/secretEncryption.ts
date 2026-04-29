import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const DEFAULT_KEY_VERSION = 1;

export interface EncryptedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

export interface MasterKeyEntry {
  version: number;
  key: Buffer;
}

function decodeMasterKey(value: string, label: string): Buffer {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label}_missing`);
  }
  let key: Buffer;
  try {
    key = Buffer.from(trimmed, "hex");
  } catch {
    throw new Error(`${label}_invalid_hex`);
  }
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(`${label}_invalid_length`);
  }
  return key;
}

function parseAdditionalKeys(raw: string | undefined): Map<number, Buffer> {
  const entries = new Map<number, Buffer>();
  if (!raw?.trim()) {
    return entries;
  }
  for (const segment of raw.split(",")) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }
    const [versionPart, keyPart] = trimmed.split(":");
    const version = Number(versionPart);
    if (!Number.isInteger(version) || version < 1) {
      throw new Error("CONTROL_PLANE_SECRET_KEYS_invalid_version");
    }
    if (!keyPart) {
      throw new Error("CONTROL_PLANE_SECRET_KEYS_missing_key");
    }
    entries.set(version, decodeMasterKey(keyPart, "CONTROL_PLANE_SECRET_KEYS"));
  }
  return entries;
}

let cachedMasterKeys: Map<number, Buffer> | null = null;
let cachedActiveVersion: number | null = null;

function loadMasterKeys(): { keys: Map<number, Buffer>; activeVersion: number } {
  if (cachedMasterKeys && cachedActiveVersion !== null) {
    return { keys: cachedMasterKeys, activeVersion: cachedActiveVersion };
  }

  const primary = decodeMasterKey(
    process.env.CONTROL_PLANE_SECRET_KEY ?? "",
    "CONTROL_PLANE_SECRET_KEY"
  );
  const additional = parseAdditionalKeys(process.env.CONTROL_PLANE_SECRET_KEYS);

  const activeVersion = (() => {
    const raw = process.env.CONTROL_PLANE_SECRET_KEY_VERSION;
    if (!raw?.trim()) {
      return DEFAULT_KEY_VERSION;
    }
    const parsed = Number(raw.trim());
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error("CONTROL_PLANE_SECRET_KEY_VERSION_invalid");
    }
    return parsed;
  })();

  const keys = new Map<number, Buffer>(additional);
  keys.set(activeVersion, primary);

  cachedMasterKeys = keys;
  cachedActiveVersion = activeVersion;
  return { keys, activeVersion };
}

export function resetSecretEncryptionForTests(): void {
  cachedMasterKeys = null;
  cachedActiveVersion = null;
}

export function getActiveKeyVersion(): number {
  return loadMasterKeys().activeVersion;
}

export function getMasterKey(version: number): Buffer {
  const { keys } = loadMasterKeys();
  const key = keys.get(version);
  if (!key) {
    throw new Error(`control_plane_secret_key_version_${version}_unavailable`);
  }
  return key;
}

export function encryptSecret(plaintext: string, keyVersion = getActiveKeyVersion()): EncryptedSecret {
  if (typeof plaintext !== "string") {
    throw new Error("plaintext_required");
  }
  const masterKey = getMasterKey(keyVersion);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv, { authTagLength: AUTH_TAG_LENGTH_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error("auth_tag_length_invalid");
  }
  return { ciphertext, iv, authTag, keyVersion };
}

export function decryptSecret(record: EncryptedSecret): string {
  if (record.iv.length !== IV_LENGTH_BYTES) {
    throw new Error("iv_length_invalid");
  }
  if (record.authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error("auth_tag_length_invalid");
  }
  const masterKey = getMasterKey(record.keyVersion);
  const decipher = createDecipheriv(ALGORITHM, masterKey, record.iv, { authTagLength: AUTH_TAG_LENGTH_BYTES });
  decipher.setAuthTag(record.authTag);
  const plaintext = Buffer.concat([decipher.update(record.ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

export const SECRET_ENCRYPTION_CONSTANTS = {
  ALGORITHM,
  KEY_LENGTH_BYTES,
  IV_LENGTH_BYTES,
  AUTH_TAG_LENGTH_BYTES,
};
